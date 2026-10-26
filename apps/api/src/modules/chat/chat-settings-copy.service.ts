import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../landings/storage.service';

export interface CopyParts {
  tags?: boolean;
  fields?: boolean;
  stages?: boolean;
  templates?: boolean;
  // Операторы и доли: у этапов и авто-распределение новых чатов ресурса.
  distribution?: boolean;
}

// Перенос настроек чата между проектами и ресурсами (2026-10-25: «возможность передать настройки
// чата между проектами»). Копия, а не перенос: источник не меняется. Одноимённое в месте назначения
// не дублируется — переиспользуется (теги, поля, этапы, папки); условия этапов перепривязываются к
// скопированным тегам/полям. Коды шаблонов уникальны в компании — у копии код получает суффикс.
@Injectable()
export class ChatSettingsCopyService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private storage: StorageService,
  ) {}

  async copy(companyId: string, user: AuthUser, from: { projectId: string; resource: string }, to: { projectId: string; resource: string }, parts: CopyParts) {
    if (from.projectId === to.projectId && from.resource === to.resource) throw new BadRequestException('Источник и назначение совпадают');
    for (const projectId of new Set([from.projectId, to.projectId])) {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    }
    const result = { tags: 0, fields: 0, stages: 0, templates: 0, distribution: 0 };
    const tagMap = new Map<string, string>();
    const fieldMap = new Map<string, string>();

    if (parts.tags || parts.stages) {
      const tags = await this.prisma.chatTag.findMany({ where: { companyId, projectId: from.projectId, resource: from.resource } });
      for (const t of tags) {
        const existing = await this.prisma.chatTag.findFirst({ where: { projectId: to.projectId, resource: to.resource, name: t.name } });
        if (existing) tagMap.set(t.id, existing.id);
        else if (parts.tags) {
          const created = await this.prisma.chatTag.create({ data: { companyId, projectId: to.projectId, resource: to.resource, name: t.name, color: t.color } });
          tagMap.set(t.id, created.id);
          result.tags++;
        }
      }
    }

    if (parts.fields || parts.stages) {
      const fields = await this.prisma.chatCustomField.findMany({ where: { companyId, projectId: from.projectId, resource: from.resource }, orderBy: { sortOrder: 'asc' } });
      for (const f of fields) {
        const existing = await this.prisma.chatCustomField.findFirst({ where: { projectId: to.projectId, resource: to.resource, name: f.name, type: f.type } });
        if (existing) fieldMap.set(f.id, existing.id);
        else if (parts.fields) {
          const created = await this.prisma.chatCustomField.create({
            data: { companyId, projectId: to.projectId, resource: to.resource, name: f.name, type: f.type, options: f.options, sortOrder: f.sortOrder },
          });
          fieldMap.set(f.id, created.id);
          result.fields++;
        }
      }
    }

    const operators = parts.distribution ? await this.operatorsFor(companyId, to.projectId) : new Map<string, boolean>();
    const usedOperators = new Set<string>();
    const keepOperators = (ops: { userId: string; weight: number }[]) => {
      const kept = ops.filter((o) => operators.has(o.userId) && o.weight > 0).map((o) => ({ userId: o.userId, weight: o.weight }));
      if (kept.reduce((s, o) => s + o.weight, 0) !== 100) return []; // без кого-то доли уже не 100% — не переносим
      kept.forEach((o) => usedOperators.add(o.userId));
      return kept;
    };

    if (parts.stages) {
      const stages = await this.prisma.chatStage.findMany({ where: { companyId, projectId: from.projectId, resource: from.resource }, include: { operators: true }, orderBy: { sortOrder: 'asc' } });
      let order = ((await this.prisma.chatStage.findFirst({ where: { projectId: to.projectId, resource: to.resource }, orderBy: { sortOrder: 'desc' } }))?.sortOrder ?? -1) + 1;
      for (const s of stages) {
        if (await this.prisma.chatStage.findFirst({ where: { projectId: to.projectId, resource: to.resource, name: s.name } })) continue;
        // Условие по тегу/полю, которых в назначении нет, превращается в ручной этап.
        const tagId = s.tagId ? tagMap.get(s.tagId) ?? null : null;
        const fieldId = s.fieldId ? fieldMap.get(s.fieldId) ?? null : null;
        const lostCondition = (s.trigger === 'TAG' && !tagId) || (s.trigger === 'FIELD' && !fieldId);
        await this.prisma.chatStage.create({
          data: {
            companyId,
            projectId: to.projectId,
            resource: to.resource,
            name: s.name,
            color: s.color,
            sortOrder: order++,
            trigger: lostCondition ? 'MANUAL' : s.trigger,
            purchaseNumber: s.purchaseNumber,
            tagId: lostCondition ? null : tagId,
            fieldId: lostCondition ? null : fieldId,
            fieldValue: lostCondition ? null : s.fieldValue,
            operators: { create: parts.distribution ? keepOperators(s.operators) : [] },
          },
        });
        result.stages++;
      }
    }

    if (parts.templates) result.templates = await this.copyTemplates(companyId, user, from, to);

    if (parts.distribution) {
      const rules = await this.prisma.chatAutoAssignRule.findMany({ where: { companyId, projectId: from.projectId, resource: from.resource, weight: { gt: 0 } } });
      const kept = keepOperators(rules);
      if (kept.length) {
        await this.prisma.$transaction([
          this.prisma.chatAutoAssignRule.deleteMany({ where: { projectId: to.projectId, resource: to.resource } }),
          this.prisma.chatAutoAssignRule.createMany({ data: kept.map((r) => ({ companyId, projectId: to.projectId, resource: to.resource, userId: r.userId, weight: r.weight, createdById: user.userId })) }),
        ]);
        result.distribution = kept.length;
      }
    }
    // Операторы этапов/распределения, которых нет в проекте назначения, добавляются в проект обычным путём.
    for (const userId of usedOperators) {
      if (!operators.get(userId)) await this.projectsService.addOperatorToProject(to.projectId, companyId, user.userId, user.role, userId);
    }
    return result;
  }

  // Действующие операторы компании → есть ли у них уже доступ к проекту назначения.
  private async operatorsFor(companyId: string, projectId: string): Promise<Map<string, boolean>> {
    const ops = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, isActive: true, role: UserRole.OPERATOR },
      select: { id: true, projectAccess: { where: { projectId }, select: { projectId: true } } },
    });
    return new Map(ops.map((o) => [o.id, o.projectAccess.length > 0]));
  }

  private async copyTemplates(companyId: string, user: AuthUser, from: { projectId: string; resource: string }, to: { projectId: string; resource: string }) {
    const folders = await this.prisma.chatTemplateFolder.findMany({
      where: { companyId, projectId: from.projectId, resource: from.resource },
      include: { templates: { include: { messages: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    let copied = 0;
    for (const folder of folders) {
      const target =
        (await this.prisma.chatTemplateFolder.findFirst({ where: { companyId, projectId: to.projectId, resource: to.resource, name: folder.name } })) ??
        (await this.prisma.chatTemplateFolder.create({ data: { companyId, projectId: to.projectId, resource: to.resource, name: folder.name, sortOrder: folder.sortOrder } }));
      for (const t of folder.templates) {
        if (await this.prisma.chatTemplate.findFirst({ where: { folderId: target.id, title: t.title } })) continue;
        const code = await this.freeCode(companyId, t.code);
        const id = randomUUID();
        const parts = t.messages.length
          ? [...t.messages].sort((a, b) => a.sortOrder - b.sortOrder)
          : [{ text: t.text, mediaKind: t.mediaKind, mediaKey: t.mediaKey, mediaFileName: t.mediaFileName, mediaMime: t.mediaMime }];
        const messages: Prisma.ChatTemplateMessageCreateWithoutTemplateInput[] = [];
        for (const [i, m] of parts.entries()) {
          let mediaKey: string | null = null;
          if (m.mediaKey) {
            mediaKey = `chat-templates/${companyId}/${id}-${randomUUID().slice(0, 8)}${path.extname(m.mediaKey)}`;
            await this.storage.copyObject(m.mediaKey, mediaKey);
          }
          messages.push({ sortOrder: i, text: m.text, mediaKind: m.mediaKind, mediaKey, mediaFileName: m.mediaFileName, mediaMime: m.mediaMime });
        }
        await this.prisma.chatTemplate.create({ data: { companyId, folderId: target.id, code, title: t.title, createdById: user.userId, messages: { create: messages } } });
        copied++;
      }
    }
    return copied;
  }

  private async freeCode(companyId: string, base: string): Promise<string> {
    if (!(await this.prisma.chatTemplate.findFirst({ where: { companyId, code: base } }))) return base;
    for (let n = 2; n < 100; n++) {
      const code = `${base}_${n}`.slice(0, 32);
      if (!(await this.prisma.chatTemplate.findFirst({ where: { companyId, code } }))) return code;
    }
    return `${base.slice(0, 20)}_${randomUUID().slice(0, 6)}`;
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatCustomField, ChatFieldType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChatService } from './chat.service';
import { ChatStagesEngine } from './chat-stages.engine';
import { chatResourceKey } from './chat-resource.util';

const MAX_FIELDS = 40;
const MAX_OPTIONS = 50;

// Свои поля лида в чате (2026-10-25, как «кастомные поля» в Chatterfy): тимлид/админ задаёт поля
// проекта (текст, длинный текст, ссылка, число, дата, выбор, мультивыбор), оператор заполняет их
// в диалоге. Значения — в Conversation.customFields; значение удалённого поля просто перестаёт
// показываться.
@Injectable()
export class ChatFieldsService {
  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
    private projectsService: ProjectsService,
    private stages: ChatStagesEngine,
  ) {}

  private async assertManage(projectId: string, companyId: string, user: AuthUser) {
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    } catch {
      throw new ForbiddenException('Поля лида настраивает тимлид или админ');
    }
  }

  async list(projectId: string, resource: string, companyId: string, user: AuthUser) {
    if (!(await this.chatService.canSeeProjectChats(companyId, user, projectId))) throw new NotFoundException('Проект не найден');
    const fields = await this.prisma.chatCustomField.findMany({ where: { projectId, companyId, resource }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    let canManage = true;
    try {
      await this.projectsService.assertCanManageProjectOperators(projectId, companyId, user.userId, user.role);
    } catch {
      canManage = false;
    }
    return { canManage, fields };
  }

  private cleanDefinition(data: { name?: string; type?: ChatFieldType; options?: string[] }, type: ChatFieldType) {
    const options =
      type === 'SELECT' || type === 'MULTISELECT'
        ? Array.from(new Set((data.options ?? []).map((o) => o.trim()).filter(Boolean))).slice(0, MAX_OPTIONS)
        : [];
    if ((type === 'SELECT' || type === 'MULTISELECT') && options.length === 0) throw new BadRequestException('Добавьте варианты для выбора');
    return options;
  }

  async create(projectId: string, resource: string, companyId: string, user: AuthUser, data: { name: string; type: ChatFieldType; options?: string[] }) {
    await this.assertManage(projectId, companyId, user);
    const name = data.name.trim();
    if (!name) throw new BadRequestException('Введите название поля');
    if ((await this.prisma.chatCustomField.count({ where: { projectId, resource } })) >= MAX_FIELDS) throw new BadRequestException(`Не больше ${MAX_FIELDS} полей в проекте`);
    const options = this.cleanDefinition(data, data.type);
    return this.prisma.chatCustomField.create({ data: { companyId, projectId, resource, name, type: data.type, options } });
  }

  // Тип поля не меняется — иначе уже записанные значения перестали бы ему соответствовать.
  async update(projectId: string, fieldId: string, companyId: string, user: AuthUser, data: { name?: string; options?: string[] }) {
    await this.assertManage(projectId, companyId, user);
    const field = await this.prisma.chatCustomField.findFirst({ where: { id: fieldId, projectId, companyId } });
    if (!field) throw new NotFoundException('Поле не найдено');
    return this.prisma.chatCustomField.update({
      where: { id: fieldId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.options ? { options: this.cleanDefinition({ options: data.options }, field.type) } : {}),
      },
    });
  }

  async remove(projectId: string, fieldId: string, companyId: string, user: AuthUser) {
    await this.assertManage(projectId, companyId, user);
    const deleted = await this.prisma.chatCustomField.deleteMany({ where: { id: fieldId, projectId, companyId } });
    if (deleted.count === 0) throw new NotFoundException('Поле не найдено');
    return { ok: true };
  }

  // Частичное обновление значений диалога: null — очистить поле.
  async setValues(conversationId: string, companyId: string, user: AuthUser, values: Record<string, unknown>) {
    const conversation = await this.chatService.loadConversation(conversationId, companyId, user);
    const fields = await this.prisma.chatCustomField.findMany({ where: { projectId: conversation.projectId, companyId, resource: chatResourceKey(conversation), id: { in: Object.keys(values) } } });
    const current = (conversation.customFields ?? {}) as Record<string, unknown>;
    const next = { ...current };
    for (const [fieldId, raw] of Object.entries(values)) {
      const field = fields.find((f) => f.id === fieldId);
      if (!field) throw new BadRequestException('Такого поля нет в проекте');
      const value = this.validate(field, raw);
      if (value === null) delete next[fieldId];
      else next[fieldId] = value;
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { customFields: next as Prisma.InputJsonValue } });
    // Этап по значению поля (2026-10-25).
    for (const [fieldId, value] of Object.entries(next)) {
      if (fieldId in values && value !== null) await this.stages.onFieldSet(conversation, fieldId, value);
    }
    return next;
  }

  private validate(field: ChatCustomField, raw: unknown): unknown {
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null;
    const fail = (msg: string) => {
      throw new BadRequestException(`Поле «${field.name}»: ${msg}`);
    };
    switch (field.type) {
      case 'TEXT':
      case 'LONG_TEXT': {
        if (typeof raw !== 'string') fail('нужен текст');
        const max = field.type === 'TEXT' ? 500 : 4000;
        const text = (raw as string).trim();
        if (text.length > max) fail(`не длиннее ${max} символов`);
        return text || null;
      }
      case 'LINK': {
        const text = String(raw).trim();
        if (!/^https?:\/\/\S+$/i.test(text)) fail('нужна ссылка, начинающаяся с http:// или https://');
        return text;
      }
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').replace(/\s/g, ''));
        if (!Number.isFinite(n)) fail('нужно число');
        return n;
      }
      case 'DATE': {
        const text = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(new Date(text).getTime())) fail('нужна дата');
        return text;
      }
      case 'SELECT': {
        const text = String(raw);
        if (!field.options.includes(text)) fail('такого варианта нет');
        return text;
      }
      case 'MULTISELECT': {
        if (!Array.isArray(raw)) fail('нужен список вариантов');
        const list = Array.from(new Set((raw as unknown[]).map(String)));
        if (list.some((v) => !field.options.includes(v))) fail('такого варианта нет');
        return list;
      }
    }
  }
}

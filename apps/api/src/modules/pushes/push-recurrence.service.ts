import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Permission, Prisma, PushRecurrence, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { formatUserName } from '../../common/user-name.util';
import { checkSubscriptionLimit } from '../../common/guards/subscription.util';
import { ProjectsService } from '../projects/projects.service';
import { PushesService } from './pushes.service';
import { CreatePushDto } from './dto/create-push.dto';
import { CreateRecurringPushDto, UpdateRecurringPushDto } from './dto/create-recurring-push.dto';
import { RecurrenceDay, isValidTimezone, nextRunAfter } from './recurrence-schedule.util';

// Сервер был недоступен дольше этого после времени отправки — такой запуск пропускаем (лучше не
// прислать понедельничную рассылку, чем прислать её в среду), и ждём следующего по расписанию.
const MISSED_RUN_LIMIT_MS = 2 * 60 * 60 * 1000;

// Регулярные рассылки по расписанию (2026-11-05). Серия хранит контент, фильтр, проекты и дни
// недели со временем; в момент срабатывания по каждому проекту создаётся обычный Push
// (recurrenceId) и отправляется тем же путём, что разовые, — с той же проверкой лимитов подписки.
@Injectable()
export class PushRecurrenceService {
  private readonly logger = new Logger(PushRecurrenceService.name);
  private ticking = false;

  constructor(
    private prisma: PrismaService,
    private projects: ProjectsService,
    private pushes: PushesService,
  ) {}

  private validateSchedule(days: RecurrenceDay[], timezone: string) {
    if (!isValidTimezone(timezone)) throw new BadRequestException('Неизвестный часовой пояс');
    const seen = new Set<number>();
    for (const d of days) {
      if (seen.has(d.day)) throw new BadRequestException('Один день недели указан дважды');
      seen.add(d.day);
    }
    const next = nextRunAfter(days, timezone, new Date());
    if (!next) throw new BadRequestException('Выберите хотя бы один день недели');
    return next;
  }

  private async assertProjects(companyId: string, user: AuthUser, projectIds: string[], permission: Permission) {
    const allowed = await this.projects.getAccessibleProjectIds(companyId, user.userId, user.role, permission);
    const bad = projectIds.filter((id) => !allowed.includes(id));
    if (bad.length) throw new ForbiddenException('Нет доступа к части выбранных проектов');
  }

  async create(companyId: string, user: AuthUser, dto: CreateRecurringPushDto) {
    const projectIds = Array.from(new Set(dto.projectIds));
    await this.assertProjects(companyId, user, projectIds, Permission.PUSHES_CREATE);
    // Контент и медиа проверяются так же, как у разовой рассылки, — до сохранения серии.
    this.pushes.validateContent(dto);
    const nextRunAt = this.validateSchedule(dto.days, dto.timezone);
    return this.prisma.pushRecurrence.create({
      data: {
        companyId,
        createdById: user.userId,
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: (dto.messageMedia as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        buttons: (dto.buttons as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        filter: dto.filter as unknown as Prisma.InputJsonValue,
        projectIds,
        days: dto.days as unknown as Prisma.InputJsonValue,
        timezone: dto.timezone,
        nextRunAt,
      },
    });
  }

  // Серии, где виден хотя бы один проект; проекты без доступа не показываем.
  async list(companyId: string, user: AuthUser) {
    const visible = await this.projects.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_VIEW);
    const editable = new Set(await this.projects.getAccessibleProjectIds(companyId, user.userId, user.role, Permission.PUSHES_CREATE));
    const rows = await this.prisma.pushRecurrence.findMany({
      where: { companyId, projectIds: { hasSome: visible.length ? visible : ['__none__'] } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    const projectIds = Array.from(new Set(rows.flatMap((r) => r.projectIds)));
    const [projects, users] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: projectIds }, companyId }, select: { id: true, name: true, deletedAt: true } }),
      this.prisma.user.findMany({
        where: { id: { in: rows.map((r) => r.createdById).filter((v): v is string => !!v) } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.createdById);
      return {
        id: r.id,
        name: r.name,
        messageText: r.messageText,
        days: r.days as unknown as RecurrenceDay[],
        timezone: r.timezone,
        isActive: r.isActive,
        nextRunAt: r.isActive ? r.nextRunAt : null,
        lastRunAt: r.lastRunAt,
        lastRunError: r.lastRunError,
        runCount: r.runCount,
        createdAt: r.createdAt,
        createdBy: u ? { id: u.id, name: formatUserName(u) || u.email } : null,
        projects: r.projectIds
          .filter((id) => visible.includes(id))
          .map((id) => ({ id, name: projectById.get(id)?.name ?? 'Проект удалён', archived: !!projectById.get(id)?.deletedAt })),
        hiddenProjects: r.projectIds.filter((id) => !visible.includes(id)).length,
        canEdit: r.projectIds.every((id) => editable.has(id)) || user.role === UserRole.OWNER || user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN,
      };
    });
  }

  private async loadEditable(id: string, companyId: string, user: AuthUser) {
    const r = await this.prisma.pushRecurrence.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Регулярная рассылка не найдена');
    const elevated = user.role === UserRole.OWNER || user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    if (!elevated) await this.assertProjects(companyId, user, r.projectIds, Permission.PUSHES_CREATE);
    return r;
  }

  async update(id: string, companyId: string, user: AuthUser, dto: UpdateRecurringPushDto) {
    const r = await this.loadEditable(id, companyId, user);
    const days = (dto.days ?? (r.days as unknown as RecurrenceDay[])) as RecurrenceDay[];
    const timezone = dto.timezone ?? r.timezone;
    const data: Prisma.PushRecurrenceUpdateInput = {};
    if (dto.projectIds) {
      // Добавлять можно только проекты, где у сотрудника есть право создавать рассылки.
      const added = dto.projectIds.filter((p) => !r.projectIds.includes(p));
      if (added.length) await this.assertProjects(companyId, user, added, Permission.PUSHES_CREATE);
      data.projectIds = Array.from(new Set(dto.projectIds));
    }
    if (dto.days || dto.timezone) {
      data.days = days as unknown as Prisma.InputJsonValue;
      data.timezone = timezone;
    }
    const willBeActive = dto.isActive ?? r.isActive;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Включили снова или поменяли расписание — следующий запуск считаем от «сейчас», без досылки
    // пропущенного, пока серия была выключена.
    if (willBeActive && (dto.isActive === true || dto.days || dto.timezone)) {
      data.nextRunAt = this.validateSchedule(days, timezone);
      data.lastRunError = null;
    }
    await this.prisma.pushRecurrence.update({ where: { id }, data });
    return { ok: true };
  }

  async remove(id: string, companyId: string, user: AuthUser) {
    await this.loadEditable(id, companyId, user);
    await this.prisma.pushRecurrence.delete({ where: { id } });
    return { ok: true };
  }

  // Раз в минуту из PushesCron.
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.prisma.pushRecurrence.findMany({ where: { isActive: true, nextRunAt: { lte: now } } });
      for (const r of due) {
        try {
          await this.runOne(r, now);
        } catch (error) {
          this.logger.warn(`Регулярная рассылка ${r.id} не отработала: ${(error as Error).message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runOne(r: PushRecurrence, now: Date) {
    const scheduledFor = r.nextRunAt!;
    const next = nextRunAfter(r.days as unknown as RecurrenceDay[], r.timezone, now);
    // Атомарный захват: двойной тик или рестарт не отправят один запуск дважды.
    const claimed = await this.prisma.pushRecurrence.updateMany({
      where: { id: r.id, isActive: true, nextRunAt: scheduledFor },
      data: { nextRunAt: next, lastRunAt: now },
    });
    if (claimed.count === 0) return;

    if (now.getTime() - scheduledFor.getTime() > MISSED_RUN_LIMIT_MS) {
      await this.prisma.pushRecurrence.update({
        where: { id: r.id },
        data: { lastRunError: `Пропущен запуск ${scheduledFor.toISOString()}: сервер был недоступен — отправка в следующий раз по расписанию` },
      });
      return;
    }

    const company = await this.prisma.company.findUnique({ where: { id: r.companyId } });
    if (!company) return;
    const { blocked, reason } = checkSubscriptionLimit(company, 'pushes');
    if (blocked) {
      await this.prisma.pushRecurrence.update({ where: { id: r.id }, data: { lastRunError: `Не отправлено: ${reason}` } });
      return;
    }

    const projects = await this.prisma.project.findMany({
      where: { id: { in: r.projectIds }, companyId: r.companyId, deletedAt: null },
      select: { id: true },
    });
    const dto: CreatePushDto = {
      name: r.name,
      messageText: r.messageText,
      messageMedia: (r.messageMedia as unknown as CreatePushDto['messageMedia']) ?? undefined,
      buttons: (r.buttons as unknown as CreatePushDto['buttons']) ?? undefined,
      filter: r.filter as unknown as CreatePushDto['filter'],
    };
    const errors: string[] = [];
    for (const p of projects) {
      try {
        const push = await this.pushes.create(p.id, dto, r.createdById ?? undefined, r.id);
        await this.pushes.send(push.id, p.id, r.companyId);
      } catch (error) {
        errors.push((error as Error).message);
        this.logger.warn(`Регулярная рассылка ${r.id}, проект ${p.id}: ${(error as Error).message}`);
      }
    }
    await this.prisma.pushRecurrence.update({
      where: { id: r.id },
      data: {
        runCount: { increment: 1 },
        lastRunError: errors.length ? `Не ушло в ${errors.length} из ${projects.length} проектов: ${errors[0].slice(0, 200)}` : null,
      },
    });
  }
}

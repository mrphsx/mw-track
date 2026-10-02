import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdminNoticeDto } from './dto/create-admin-notice.dto';

// Сколько объявлений показывать в колоколе — объявления копятся, пока сотрудник не нажмёт
// "Очистить все", так что потолок нужен; свежие важнее старых, поэтому берём последние.
const NOTICES_LIMIT = 20;

// Объявления супер-админа (запрос пользователя 2026-10-02: "хочу чтобы я с панели администрации
// мог отправлять выбранным компаниям (либо всем) оповещение"). Единственный сервис, который
// читают и арендаторы (свой колокол), и платформенная админка (отправка/список отправленного) —
// отсюда две группы методов в одном классе.
//
// Таблицы НЕ в modelsWithCompany (см. комментарий у модели AdminNotice): companyId nullable и
// означает "всем компаниям", поэтому автоскоупинг middleware скрыл бы как раз общие объявления.
// Каждый запрос ниже скоупится companyId вручную.
@Injectable()
export class NoticesService {
  constructor(private prisma: PrismaService) {}

  // Объявление видно сотруднику компании, если оно адресовано его компании или всем, и он сам
  // его не скрыл через "Очистить все" (clearedAt). Прочитанное (readAt) из списка НЕ уходит —
  // по прямому требованию: "оповещение становится прочитанным но остается в списке".
  private visibleWhere(companyId: string, userId: string) {
    return {
      OR: [{ companyId }, { companyId: null }],
      reads: { none: { userId, clearedAt: { not: null } } },
    };
  }

  async listForUser(companyId: string, userId: string) {
    const notices = await this.prisma.adminNotice.findMany({
      where: this.visibleWhere(companyId, userId),
      orderBy: { createdAt: 'desc' },
      take: NOTICES_LIMIT,
      include: { reads: { where: { userId }, select: { readAt: true } } },
    });

    return notices.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt,
      read: !!n.reads[0]?.readAt,
    }));
  }

  async markRead(companyId: string, userId: string, noticeId: string) {
    // Проверяем адресность, а не просто существование: иначе чужое адресное объявление можно
    // было бы "прочитать" по угаданному id и тем самым узнать, что оно есть.
    const notice = await this.prisma.adminNotice.findFirst({
      where: { id: noticeId, OR: [{ companyId }, { companyId: null }] },
      select: { id: true },
    });
    if (!notice) throw new NotFoundException('Объявление не найдено');

    const readAt = new Date();
    await this.prisma.adminNoticeRead.upsert({
      where: { noticeId_userId: { noticeId, userId } },
      create: { noticeId, userId, readAt },
      update: { readAt },
    });
    return { ok: true };
  }

  // "Очистить все" — скрывает у ЭТОГО сотрудника всё, что он видит сейчас. У остальных
  // сотрудников компании объявления остаются: состояние хранится на пользователе, не на компании.
  async clearAllForUser(companyId: string, userId: string) {
    const notices = await this.prisma.adminNotice.findMany({
      where: this.visibleWhere(companyId, userId),
      select: { id: true },
    });
    if (!notices.length) return { cleared: 0 };

    const clearedAt = new Date();
    await this.prisma.$transaction(
      notices.map((n) =>
        this.prisma.adminNoticeRead.upsert({
          where: { noticeId_userId: { noticeId: n.id, userId } },
          create: { noticeId: n.id, userId, readAt: clearedAt, clearedAt },
          update: { clearedAt },
        }),
      ),
    );
    return { cleared: notices.length };
  }

  // --- сторона платформенной админки (SUPER_ADMIN, см. AdminController) ---

  // Пустой/отсутствующий companyIds = одна строка с companyId: null, то есть "всем компаниям,
  // включая те, что зарегистрируются позже". Выбранные компании = по строке на компанию: читающий
  // запрос остаётся одним OR без join-таблицы адресатов.
  //
  // Отдельной записи в AdminActionLog нет сознательно: там companyId обязателен (рассылку "всем"
  // туда не записать), а сама строка AdminNotice уже хранит кто, когда и кому отправил — в
  // отличие от правки баланса/подписки, которая меняет другую таблицу и без лога не видна.
  async createFromAdmin(adminUserId: string, dto: CreateAdminNoticeDto) {
    const title = dto.title.trim();
    const body = dto.body.trim();

    if (!dto.companyIds?.length) {
      const notice = await this.prisma.adminNotice.create({
        data: { title, body, createdById: adminUserId, companyId: null },
      });
      return { created: 1, toAll: true, ids: [notice.id] };
    }

    // Только существующие неудалённые компании — иначе FK упал бы на всей рассылке из-за одного
    // устаревшего id в запросе.
    const companies = await this.prisma.company.findMany({
      where: { id: { in: dto.companyIds }, deletedAt: null },
      select: { id: true },
    });
    if (!companies.length) throw new NotFoundException('Компании не найдены');

    await this.prisma.adminNotice.createMany({
      data: companies.map((c) => ({ title, body, createdById: adminUserId, companyId: c.id })),
    });
    return { created: companies.length, toAll: false, skipped: dto.companyIds.length - companies.length };
  }

  async listForAdmin(page = 1, limit = 50) {
    const take = Math.min(limit, 200);
    const [items, total] = await Promise.all([
      this.prisma.adminNotice.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * take,
        take,
        include: {
          company: { select: { id: true, name: true } },
          createdBy: { select: { email: true } },
          _count: { select: { reads: true } },
        },
      }),
      this.prisma.adminNotice.count(),
    ]);

    return {
      items: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt,
        company: n.company,
        createdByEmail: n.createdBy.email,
        // Сколько сотрудников его уже открыли или скрыли — строка AdminNoticeRead появляется
        // только после реального действия получателя.
        interactions: n._count.reads,
      })),
      total,
      page,
      totalPages: Math.ceil(total / take),
    };
  }

  // Отозвать ошибочно отправленное объявление (рассылка "всем" иначе остаётся у всех навсегда).
  // Реальное удаление строки: AdminNoticeRead уходит каскадом, это объявление, а не данные
  // арендатора (см. комментарий у модели).
  async deleteFromAdmin(noticeId: string) {
    const notice = await this.prisma.adminNotice.findUnique({ where: { id: noticeId }, select: { id: true } });
    if (!notice) throw new NotFoundException('Объявление не найдено');
    await this.prisma.adminNotice.delete({ where: { id: noticeId } });
    return { ok: true };
  }
}

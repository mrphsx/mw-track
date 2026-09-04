import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { ClientFiltersDto } from '../clients/dto/client-filters.dto';
import { PushesService } from '../pushes/pushes.service';
import { LandingsService } from '../landings/landings.service';
import { LandingRendererService } from '../landings/landing-renderer.service';
import { DomainsService } from '../domains/domains.service';
import { TeamService } from '../team/team.service';
import { runAsCompany } from './run-as-company.util';
import { TopUpBalanceDto } from './dto/top-up-balance.dto';
import { UpdateCompanyRestrictionsDto } from './dto/update-company-restrictions.dto';

// Дрилл-даун по одной конкретной компании (Фаза 4.3B, запрос пользователя 2026-07-19) —
// переиспользует СУЩЕСТВУЮЩИЕ company-scoped сервисы без единой правки в них самих, через
// runAsCompany для моделей из modelsWithCompany (Project/Landing/Client) и напрямую для тех,
// что уже принимают явный companyId (Push/Domain/User). См. run-as-company.util.ts за полным
// обоснованием.
@Injectable()
export class AdminCompanyService {
  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    private pushesService: PushesService,
    private landingsService: LandingsService,
    private rendererService: LandingRendererService,
    private domainsService: DomainsService,
    private teamService: TeamService,
  ) {}

  // ModuleRef, не constructor injection — подтверждено вживую (2026-07-20), что прямой импорт
  // ProjectsModule/ClientsModule в AdminModule роняет бут циклическим DI ("ClientsModule
  // imports[0] is undefined", ProjectsModule -(forwardRef)-> ChannelsModule -> ClientsModule ->
  // ProjectsModule) — тот же класс проблемы, что уже 4 раза встречался в проекте (см. память),
  // тот же приём, что уже у AudienceService.
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  private getClientsService(): ClientsService {
    return this.moduleRef.get(ClientsService, { strict: false });
  }

  async getOverview(companyId: string, adminUserId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    // Аудит read-доступа (найдено при аудите панели администратора 2026-07-30: AdminActionLog
    // раньше писался только для МУТИРУЮЩИХ действий — не было ни следа того, кто и когда
    // просто ПРОСМОТРЕЛ данные другой компании через runAsCompany, хотя именно это открывает
    // доступ к чужому PII). Пишем один раз на открытие карточки компании (getOverview —
    // единственный вызов, который срабатывает при каждом заходе на /companies/:id), не на
    // каждую под-вкладку (projects/landings/domains/team отдельно залогировали бы 5-6 строк на
    // один визит админа — шум, не сигнал). Fire-and-forget: не блокируем и не роняем сам
    // overview, если запись лога почему-то не удалась.
    this.prisma.adminActionLog
      .create({ data: { adminUserId, companyId, action: 'COMPANY_VIEWED', previousValue: {}, newValue: {} } })
      .catch(() => {});

    // User/Domain вне modelsWithCompany — считаются напрямую, без runAsCompany.
    // role: {not: SUPER_ADMIN} — тот же фильтр, что уже у TeamService.findAll (вкладка
    // "Команда" не показывает SUPER_ADMIN-аккаунты), иначе для компании, в которой живёт сам
    // супер-админ (сейчас единственная реальная компания на платформе — см. память), teamSize
    // здесь и число строк во вкладке "Команда" разъезжались бы на единицу без видимой причины
    // (найдено живой проверкой 2026-07-20).
    const [teamSize, domainCount] = await Promise.all([
      this.prisma.user.count({ where: { companyId, deletedAt: null, role: { not: UserRole.SUPER_ADMIN } } }),
      this.prisma.domain.count({ where: { companyId, deletedAt: null } }),
    ]);

    // Project/Landing/Client — внутри runAsCompany, иначе middleware подменит companyId на
    // компанию самого админа. clientCount здесь намеренно БЕЗ фильтра origin:'ours' (в отличие
    // от вкладки "Клиенты" внутри конкретного проекта, ClientsService.findMany с дефолтными
    // filters={}, где origin по умолчанию 'ours' — только subscribedAt не null) — это реальные,
    // а не ошибочные разные числа: overview отвечает "сколько вообще Client-строк у компании",
    // вкладка проекта — "сколько из них наши подписчики по умолчанию" (тот же дефолт, что и в
    // самой CRM). Не "чинить" это в одно число, если оба места снова разойдутся на глаз.
    const [projectCount, landingCount, clientCount] = await runAsCompany(companyId, adminUserId, () =>
      Promise.all([
        this.prisma.project.count({ where: { companyId, deletedAt: null } }),
        this.prisma.landing.count({ where: { companyId, deletedAt: null } }),
        this.prisma.client.count({ where: { companyId, deletedAt: null } }),
      ]),
    );

    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      createdAt: company.createdAt,
      plan: company.plan,
      balance: company.balance,
      planExpiresAt: company.planExpiresAt,
      teamSize,
      projectCount,
      landingCount,
      clientCount,
      domainCount,
      pushesBlocked: company.pushesBlocked,
      domainsBlocked: company.domainsBlocked,
      isSuspended: company.isSuspended,
    };
  }

  async getProjects(companyId: string, adminUserId: string) {
    return runAsCompany(companyId, adminUserId, () => this.getProjectsService().findAll(companyId, adminUserId, UserRole.SUPER_ADMIN));
  }

  // Проверка "проект действительно принадлежит этой компании" ДО того, как отдать его
  // клиентов/пуши — без этого супер-админ мог бы подставить произвольный чужой projectId и
  // получить данные компании, на которую сейчас не смотрит (URL целиком под его контролем).
  private async assertProjectInCompany(companyId: string, adminUserId: string, projectId: string): Promise<void> {
    const project = await runAsCompany(companyId, adminUserId, () => this.prisma.project.findFirst({ where: { id: projectId } }));
    if (!project) throw new NotFoundException('Проект не найден в этой компании');
  }

  async getProjectClients(companyId: string, adminUserId: string, projectId: string, filters: ClientFiltersDto) {
    await this.assertProjectInCompany(companyId, adminUserId, projectId);
    // Платформенный SUPER_ADMIN — полная деталь пересечения (canViewCrossProject: true), не
    // сужается до чьей-то per-project видимости, тот же принцип, что и TeamService.findAll выше.
    return runAsCompany(companyId, adminUserId, () => this.getClientsService().findMany(projectId, filters, companyId, true));
  }

  async getProjectPushes(companyId: string, adminUserId: string, projectId: string) {
    await this.assertProjectInCompany(companyId, adminUserId, projectId);
    return this.pushesService.findAll(projectId);
  }

  async getLandings(companyId: string, adminUserId: string) {
    return runAsCompany(companyId, adminUserId, () => this.landingsService.findAllForCompany(companyId, adminUserId, UserRole.SUPER_ADMIN));
  }

  // Превью лендинга из дрилл-дауна компании (запрос пользователя 2026-07-20) — переиспользует
  // тот же renderPreviewHtml, что и обычная кнопка "Предпросмотр" в CRM (apps/web
  // landing-card.tsx), но с явным companyId ЦЕЛЕВОЙ компании через runAsCompany: Landing в
  // modelsWithCompany, поэтому прямой вызов renderPreviewHtml(id, companyId) без обёртки
  // получил бы companyId самого админа из AsyncLocalStorage и всегда бросал бы "Лендинг не найден".
  async getLandingPreview(companyId: string, adminUserId: string, landingId: string): Promise<string> {
    return runAsCompany(companyId, adminUserId, () => this.rendererService.renderPreviewHtml(landingId, companyId));
  }

  async getDomains(companyId: string) {
    return this.domainsService.findAll(companyId);
  }

  // Реальная история крипто-платежей (запрос пользователя 2026-07-30, аудит панели
  // администратора — раньше супер-админ видел только материализованный Company.balance и
  // собственные ADMIN_CREDIT-записи, не то, откуда баланс компании реально взялся). Invoice не
  // входит в modelsWithCompany — прямой запрос с явным companyId уже безопасен, runAsCompany
  // не нужен (тот же случай, что Domain/Push/User).
  async getInvoices(companyId: string) {
    return this.prisma.invoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }

  // Платформенный SUPER_ADMIN смотрит на команду ЛЮБОЙ компании целиком (не сужается до
  // OPERATOR_ADMIN'овской зоны — тот особый случай специфичен для реальных участников этой
  // конкретной компании, не для платформенного администратора). requesterId не используется
  // TeamService.findAll ни для одной ветки кроме OPERATOR_ADMIN, поэтому пустая строка безопасна.
  async getTeam(companyId: string) {
    return this.teamService.findAll(companyId, '', UserRole.SUPER_ADMIN);
  }

  // Пополнение баланса компании (Фаза 4.3C, запрос пользователя 2026-07-19) — без верхней
  // границы/подтверждения (явный выбор пользователя), но атомарно: баланс + запись в
  // BalanceTransaction (type ADMIN_CREDIT, отдельно от настоящих крипто-TOPUP) + запись в
  // AdminActionLog — одной транзакцией, чтобы начисление не могло разойтись с аудит-логом.
  // Company не в modelsWithCompany — runAsCompany не нужен, обычный prisma-вызов уже безопасен.
  async topUpBalance(companyId: string, adminUserId: string, dto: TopUpBalanceDto) {
    const before = await this.prisma.company.findUnique({ where: { id: companyId }, select: { balance: true } });
    if (!before) throw new NotFoundException('Компания не найдена');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { balance: { increment: dto.amount } },
      });

      await tx.balanceTransaction.create({
        data: {
          companyId,
          type: 'ADMIN_CREDIT',
          amount: dto.amount,
          balanceAfter: updated.balance,
        },
      });

      await tx.adminActionLog.create({
        data: {
          adminUserId,
          companyId,
          action: 'BALANCE_TOPUP',
          previousValue: { balance: before.balance },
          newValue: { balance: updated.balance, amount: dto.amount },
        },
      });

      return updated;
    });
  }

  // Ограничения (Фаза 4.3D, запрос пользователя 2026-07-19) — частичное обновление, только
  // переданные поля. Company не в modelsWithCompany — runAsCompany не нужен.
  async updateRestrictions(companyId: string, adminUserId: string, dto: UpdateCompanyRestrictionsDto) {
    const before = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { pushesBlocked: true, domainsBlocked: true, isSuspended: true },
    });
    if (!before) throw new NotFoundException('Компания не найдена');

    const [updated] = await this.prisma.$transaction([
      this.prisma.company.update({ where: { id: companyId }, data: dto }),
      this.prisma.adminActionLog.create({
        data: {
          adminUserId,
          companyId,
          action: 'RESTRICTIONS_CHANGE',
          previousValue: before,
          newValue: { ...before, ...dto },
        },
      }),
    ]);

    return updated;
  }

  // Принудительное удаление домена (Фаза 4.3D) — переиспользует существующий
  // DomainsService.remove(id, companyId) напрямую (Domain не в modelsWithCompany, уже
  // принимает явный companyId — обёртка runAsCompany не нужна), просто с записью в аудит-лог.
  async forceDeleteDomain(companyId: string, adminUserId: string, domainId: string) {
    const domain = await this.domainsService.findOne(domainId, companyId);
    await this.domainsService.remove(domainId, companyId);

    await this.prisma.adminActionLog.create({
      data: {
        adminUserId,
        companyId,
        action: 'DOMAIN_FORCE_DELETE',
        previousValue: { domain: domain.domain },
        newValue: {},
      },
    });
  }
}

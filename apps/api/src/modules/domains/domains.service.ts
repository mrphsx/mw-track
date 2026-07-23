import { exec } from 'child_process';
import * as dns from 'dns/promises';
import { promisify } from 'util';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Domain, DomainPath, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NginxService } from '../landings/nginx.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpsertDomainPathDto } from './dto/upsert-domain-path.dto';
import { normalizeDomainPath } from './domain-path.util';
import { ProjectsService } from '../projects/projects.service';

const execAsync = promisify(exec);

export interface DomainWithInstructions extends Domain {
  instructions: {
    txtName: string;
    txtValue: string;
    aRecordTarget: string | null; // null — SERVER_PUBLIC_IP не настроен в этой среде
  };
}

// Подтягиваем название лендинга/проекта (или группы теста, запрос пользователя 2026-07-17)
// прямо здесь — иначе фронту пришлось бы делать отдельный запрос на каждый путь только чтобы
// показать человекочитаемую подпись. Ровно один из двух будет не-null на каждой строке.
const PATH_WITH_LANDING_INCLUDE = {
  landing: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
  abTestGroup: { select: { id: true, name: true, landings: { select: { name: true } } } },
} as const;

export type DomainPathWithLanding = DomainPath & {
  landing: { id: string; name: string; project: { id: string; name: string } } | null;
  abTestGroup: { id: string; name: string | null; landings: { name: string }[] } | null;
};

// Self-service домены (решение от 2026-06-27, см. 04_BACKEND_PROJECTS_DOMAINS.md): клиент сам
// владеет доменом и настраивает его DNS (в своём Cloudflare-аккаунте или любом другом) —
// платформа не держит Cloudflare API-токен и не управляет чужим DNS. Мы только: 1) проверяем
// TXT-запись (владение), 2) выпускаем SSL через Certbot HTTP-01 challenge (что само по себе
// доказывает, что A/CNAME реально указывает на наш сервер — иначе challenge не дойдёт), 3) пишем
// Nginx server block (домен-агностичный, см. NginxService.renderTarget).
//
// Один домен -> много лендингов/проектов через путь (2026-06-29, DomainPath, замена старой
// прямой связи Domain.landingId). Nginx больше не знает про лендинги вообще — он всегда
// проксирует на internal/serve-by-domain, а LandingRendererService.renderByDomain (см.
// domain-path.util.ts) сам матчит Host+путь против DomainPath этого домена. Голый домен без
// явного маппинга пути (включая "/") теперь не отдаёт контент — раньше это было неявным
// поведением через Domain.landingId.
@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private prisma: PrismaService,
    private nginx: NginxService,
    private config: ConfigService,
    private moduleRef: ModuleRef,
  ) {}

  // ProjectsService резолвится лениво через ModuleRef, не конструкторной инъекцией — тот же
  // паттерн, что уже применён в PurchasesService/AutomationsController (см. память
  // feedback_bot_scenarios/feedback_automation_flows) — избегаем риска циклического
  // require на уровне модулей при прямой инъекции между доменами, которые сейчас не связаны
  // module-графом напрямую (DomainsModule импортирует только LandingsModule).
  private getProjectsService(): ProjectsService {
    return this.moduleRef.get(ProjectsService, { strict: false });
  }

  private withInstructions(domain: Domain): DomainWithInstructions {
    return {
      ...domain,
      instructions: {
        txtName: `_verify.${domain.domain}`,
        txtValue: domain.verificationToken,
        aRecordTarget: this.config.get<string>('SERVER_PUBLIC_IP') || null,
      },
    };
  }

  async create(companyId: string, dto: CreateDomainDto): Promise<DomainWithInstructions> {
    // Ручная блокировка создания доменов супер-админом (Фаза 4.3D, запрос пользователя
    // 2026-07-19) — этот метод раньше не имел вообще никакого guard/лимита.
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { domainsBlocked: true } });
    if (company.domainsBlocked) {
      throw new ForbiddenException('Создание доменов для этой компании заблокировано администратором');
    }

    try {
      const domain = await this.prisma.domain.create({
        data: { companyId, domain: dto.domain.toLowerCase(), projectId: dto.projectId },
      });
      return this.withInstructions(domain);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Этот домен уже добавлен');
      }
      throw error;
    }
  }

  async findAll(companyId: string): Promise<(DomainWithInstructions & { paths: DomainPathWithLanding[] })[]> {
    const domains = await this.prisma.domain.findMany({
      where: { companyId },
      include: { paths: { orderBy: { path: 'asc' }, include: PATH_WITH_LANDING_INCLUDE } },
      orderBy: { createdAt: 'desc' },
    });
    return domains.map((d) => ({ ...this.withInstructions(d), paths: d.paths }));
  }

  async findOne(id: string, companyId: string): Promise<DomainWithInstructions> {
    const domain = await this.prisma.domain.findFirst({ where: { id, companyId } });
    if (!domain) throw new NotFoundException('Домен не найден');
    return this.withInstructions(domain);
  }

  private async findOneRaw(id: string, companyId: string): Promise<Domain> {
    const domain = await this.prisma.domain.findFirst({ where: { id, companyId } });
    if (!domain) throw new NotFoundException('Домен не найден');
    return domain;
  }

  // Помимо company-владения (что и проверялось раньше) — если это restricted-роль
  // (BUYER/OPERATOR), дополнительно требуем ProjectAccess к проекту ЭТОГО лендинга. Без этого
  // Buyer с доступом только к проекту A мог привязать домен-путь к лендингу проекта B того же
  // company (баг найден при проектировании гранулярных прав, 2026-07-17).
  private async assertLandingOwnership(companyId: string, landingId: string, userId: string, role: UserRole): Promise<void> {
    const landing = await this.prisma.landing.findFirst({ where: { id: landingId, companyId, deletedAt: null } });
    if (!landing) throw new NotFoundException('Лендинг не найден');
    await this.getProjectsService().assertAccess(landing.projectId, companyId, userId, role);
  }

  private async assertAbTestGroupOwnership(companyId: string, abTestGroupId: string, userId: string, role: UserRole): Promise<void> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: abTestGroupId, companyId, deletedAt: null } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');
    await this.getProjectsService().assertAccess(group.projectId, companyId, userId, role);
  }

  // Без deletedAt-колонки на Domain (как и у Channel, см. CLAUDE.md) — домен глобально
  // уникален по hostname, soft-delete заблокировал бы повторное добавление того же домена.
  async remove(id: string, companyId: string): Promise<void> {
    const domain = await this.findOneRaw(id, companyId);
    try {
      await this.nginx.removeServerBlock(domain.domain);
    } catch (error) {
      this.logger.warn(`removeServerBlock failed for ${domain.domain}: ${(error as Error).message}`);
    }
    await this.prisma.domain.delete({ where: { id } });
  }

  async listPaths(domainId: string, companyId: string): Promise<DomainPathWithLanding[]> {
    await this.findOneRaw(domainId, companyId);
    return this.prisma.domainPath.findMany({
      where: { domainId },
      orderBy: { path: 'asc' },
      include: PATH_WITH_LANDING_INCLUDE,
    });
  }

  // Один путь -> один лендинг ЛИБО одна группа A/B/n-теста (запрос пользователя 2026-07-17,
  // ровно одно из двух — см. CHECK-констрейнт в миграции), любого проекта компании (не
  // обязательно того, что указан в Domain.projectId — он опционален и сам по себе ни на что не
  // влияет, см. note в DTO). Создание/редактирование пути — чистая операция с БД, без касания
  // Nginx/Certbot: маршрутизация путь->лендинг/группа резолвится бэкендом на каждый запрос
  // (LandingRendererService.renderByDomain), а не записывается в nginx-конфиг, поэтому
  // добавление/смена/удаление путей не требует nginx reload вообще.
  async upsertPath(domainId: string, companyId: string, dto: UpsertDomainPathDto, userId: string, role: UserRole): Promise<DomainPathWithLanding> {
    await this.findOneRaw(domainId, companyId);

    if (!!dto.landingId === !!dto.abTestGroupId) {
      throw new BadRequestException('Укажите либо лендинг, либо группу A/B-теста — ровно одно');
    }
    if (dto.landingId) await this.assertLandingOwnership(companyId, dto.landingId, userId, role);
    if (dto.abTestGroupId) await this.assertAbTestGroupOwnership(companyId, dto.abTestGroupId, userId, role);

    const path = normalizeDomainPath(dto.path);
    const target = { landingId: dto.landingId ?? null, abTestGroupId: dto.abTestGroupId ?? null };

    try {
      return await this.prisma.domainPath.upsert({
        where: { domainId_path: { domainId, path } },
        create: { domainId, path, ...target },
        update: target,
        include: PATH_WITH_LANDING_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Путь ${path} уже занят на этом домене`);
      }
      throw error;
    }
  }

  async removePath(domainId: string, pathId: string, companyId: string): Promise<void> {
    await this.findOneRaw(domainId, companyId);
    const path = await this.prisma.domainPath.findFirst({ where: { id: pathId, domainId } });
    if (!path) throw new NotFoundException('Путь не найден');
    await this.prisma.domainPath.delete({ where: { id: pathId } });
  }

  // Резолвинг входящего запроса (Host+путь -> лендинг+subPath) живёт в LandingRendererService,
  // не здесь — см. domain-path.util.ts. Иначе InternalController (LandingsModule) пришлось бы
  // импортировать DomainsModule, а тот уже импортирует LandingsModule за NginxService —
  // циклическая зависимость модулей.

  async verify(id: string, companyId: string): Promise<DomainWithInstructions> {
    const domain = await this.findOneRaw(id, companyId);
    if (domain.status === 'ACTIVE') return this.withInstructions(domain); // уже всё проверено, повторно не дёргаем Certbot

    const txtOk = await this.checkTxtRecord(domain.domain, domain.verificationToken);
    if (!txtOk) {
      const updated = await this.prisma.domain.update({
        where: { id },
        data: { status: 'PENDING', lastCheckError: 'TXT-запись не найдена или не совпадает со значением' },
      });
      return this.withInstructions(updated);
    }

    await this.prisma.domain.update({
      where: { id },
      data: { status: 'VERIFYING', verifiedAt: domain.verifiedAt ?? new Date() },
    });

    // Сайт в nginx должен существовать (listen 80 + server_name) ДО запуска certbot —
    // certbot --nginx ищет существующий блок с этим server_name, чтобы дополнить его
    // ssl_certificate/listen 443 и добавить редирект с 80. Без этого шага он откажет
    // с "could not find a usable server block" ещё до похода за HTTP-01 challenge'ем.
    try {
      await this.nginx.addServerBlock(domain.domain);
    } catch (error) {
      const message = (error as Error).message.slice(-500);
      this.logger.warn(`addServerBlock failed for ${domain.domain}: ${message}`);
      const updated = await this.prisma.domain.update({
        where: { id },
        data: { status: 'PENDING', sslStatus: 'error', lastCheckError: `Nginx: ${message}` },
      });
      return this.withInstructions(updated);
    }

    try {
      await this.issueCertificate(domain.domain);
    } catch (error) {
      // Хвост (не начало!) сообщения — exec кладёт в message сначала саму команду,
      // а реальная причина (ACME-валидация и т.п.) у certbot всегда печатается последней.
      const message = (error as Error).message.slice(-500);
      this.logger.warn(`Certbot failed for ${domain.domain}: ${message}`);
      const updated = await this.prisma.domain.update({
        where: { id },
        data: { status: 'PENDING', sslStatus: 'error', lastCheckError: `Certbot: ${message}` },
      });
      return this.withInstructions(updated);
    }

    const updated = await this.prisma.domain.update({
      where: { id },
      data: { status: 'ACTIVE', sslStatus: 'active', lastCheckError: null },
    });
    return this.withInstructions(updated);
  }

  private async checkTxtRecord(domain: string, token: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`_verify.${domain}`);
      return records.some((chunks) => chunks.join('') === token);
    } catch (error) {
      this.logger.warn(`TXT lookup failed for ${domain}: ${(error as Error).message}`);
      return false;
    }
  }

  // Системный certbot (тот же бинарь и тот же способ — `--nginx` authenticator+installer —
  // которым на этом сервере уже выпущены сертификаты для других, не связанных с TrafficCRM
  // доменов). Плагин nginx сам находит server_name-блок, который addServerBlock() выше уже
  // создал, дополняет его ssl_certificate/listen 443 и добавляет редирект с 80 — нам не нужно
  // ни поднимать свой webroot, ни самим перезагружать nginx после выпуска.
  // --expand обязателен: certbot матчит запрошенные домены с уже существующими ИМЕНОВАННЫМИ
  // сертификатами (renewal-конфиги в /etc/letsencrypt/renewal) независимо от текущего nginx-конфига —
  // если на этот домен (bare, без www) уже когда-то выпускался сертификат БЕЗ www (например, домен
  // раньше использовался для чего-то другого на этом же сервере), certbot -n без --expand откажет
  // ("...--expand flag"), а не просто расширит существующий сертификат.
  private async issueCertificate(domain: string): Promise<void> {
    const email = this.config.get<string>('CERTBOT_EMAIL') || 'admin@example.com';
    await execAsync(
      `certbot --nginx -d ${domain} -d www.${domain} --email ${email} --agree-tos --no-eff-email -n --redirect --expand`,
    );
  }
}

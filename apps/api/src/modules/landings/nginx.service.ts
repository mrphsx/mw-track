import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const execAsync = promisify(exec);

// Этот сервер уже работает как прод (см. 14_INFRA_AND_DEPLOY.md, раздел "Реальный
// деплой 2026-06-29"): nginx — системный (apt, systemd), не контейнер, и держит
// порты 80/443 для других, не относящихся к TrafficCRM сайтов на этом же хосте —
// поднять ещё один nginx в Docker на тех же портах невозможно. Поэтому домены
// клиентов TrafficCRM добавляются как обычные сайты этого же системного nginx,
// тем же способом (`certbot --nginx`), каким на этом сервере уже выпущены
// сертификаты для других проектов.
//
// Файл сайта (sitesDir) разбит на "внешний" блок (server_name/listen) и
// "целевой" инклюд (targetsDir) с реальным proxy_pass на лендинг. Это специально:
// после первого успешного certbot --nginx внешний файл перестаёт быть "нашим" —
// certbot сам переписывает в нём listen/ssl_certificate (см. DomainsService) и
// перезатирать его целиком при каждой смене лендинга означало бы стирать
// выпущенный сертификат. Целевой инклюд certbot не трогает вообще, поэтому его
// можно свободно перезаписывать на каждый attachLanding().
@Injectable()
export class NginxService {
  private readonly logger = new Logger(NginxService.name);
  private readonly sitesDir: string;
  private readonly targetsDir: string;

  constructor(private config: ConfigService) {
    this.sitesDir = this.config.get<string>('NGINX_SITES_DIR') || '/etc/nginx/sites-enabled';
    this.targetsDir = this.config.get<string>('NGINX_TARGETS_DIR') || '/etc/nginx/trafficcrm-targets';
  }

  private siteFile(domain: string): string {
    return path.join(this.sitesDir, domain);
  }

  private targetFile(domain: string): string {
    return path.join(this.targetsDir, `${domain}.conf`);
  }

  // Пишется один раз на домен, до первого certbot --nginx (см. DomainsService.verify) —
  // именно этот server_name-блок certbot ищет и дополняет ssl_certificate/listen 443.
  private renderSiteBlock(domain: string): string {
    return `server {
    listen 80;
    server_name ${domain} www.${domain};
    include ${this.targetFile(domain)};
}
`;
  }

  // location-блок отдельно от server_name-блока. С 2026-06-29 (один домен -> много
  // лендингов/проектов через путь, см. DomainPath) этот файл домен-агностичен и landingId
  // больше не принимает — весь маппинг путь->лендинг живёт в БД и резолвится бэкендом
  // (DomainsService.resolveByHostAndPath) по заголовку Host + запрошенному пути. Поэтому
  // файл пишется один раз при создании домена и больше никогда не меняется при
  // добавлении/удалении путей — раньше (1 домен = 1 лендинг) этот файл переписывался на
  // каждый attachLanding(), что требовало лишнего nginx reload на простую смену привязки.
  private renderTarget(): string {
    return `location / {
    proxy_pass http://127.0.0.1:3001/api/v1/internal/serve-by-domain$request_uri;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
`;
  }

  async addServerBlock(domain: string): Promise<void> {
    await fs.mkdir(this.sitesDir, { recursive: true });
    await fs.mkdir(this.targetsDir, { recursive: true });

    // В отличие от старого варианта (1 домен = 1 лендинг), контент таргета теперь всегда
    // одинаковый и домен-агностичный — переписывать его безусловно дешево и идемпотентно,
    // и это единственный способ донести новый формат до доменов, у которых таргет-файл
    // остался от старой версии (до DomainPath) с захардкоженным landingId внутри.
    await fs.writeFile(this.targetFile(domain), this.renderTarget(), 'utf-8');

    const siteFilePath = this.siteFile(domain);
    const siteFileExists = await fs
      .access(siteFilePath)
      .then(() => true)
      .catch(() => false);
    if (!siteFileExists) {
      // Этот nginx общий с другими, не относящимися к TrafficCRM сайтами на этом
      // сервере (см. NginxService doc-комментарий выше) — если домен уже обслуживается
      // КАКИМ-ТО другим server_name-блоком (например, кто-то добавил домен, который
      // на самом деле уже занят другим проектом на этом же хосте), наш новый файл
      // тут не поможет: nginx молча проигнорирует второй блок с тем же server_name
      // ("conflicting server name ... ignored") — и certbot --nginx после этого либо
      // найдёт ЧУЖОЙ сертификат с другим набором имён и откажется (нужен --expand),
      // либо, что хуже, реально модифицирует чужой сертификат/блок. Лучше явно
      // отказать на этом шаге, чем оставить тихо игнорируемый, нерабочий файл.
      await this.assertNoConflictingServerName(domain);
      await fs.writeFile(siteFilePath, this.renderSiteBlock(domain), 'utf-8');
    }
    await this.reload();
  }

  private async assertNoConflictingServerName(domain: string): Promise<void> {
    const { stdout } = await execAsync('nginx -T');
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`server_name[^;]*\\b${escaped}\\b`);
    if (pattern.test(stdout)) {
      throw new Error(
        `Домен ${domain} уже обслуживается другим server_name-блоком в nginx на этом сервере — ` +
          `добавить его через TrafficCRM нельзя без ручного вмешательства в существующий конфиг`,
      );
    }
  }

  async removeServerBlock(domain: string): Promise<void> {
    await fs.rm(this.siteFile(domain), { force: true });
    await fs.rm(this.targetFile(domain), { force: true });
    await this.reload();
  }

  // В отличие от старого dev-варианта (молча проглатывал ошибку — там это был
  // ещё не запущенный dev-контейнер), здесь nginx реально обслуживает чужие живые
  // сайты на этом сервере: `nginx -t` обязателен и его провал должен долетать до
  // вызывающего кода как настоящая ошибка, а не тихо логироваться, иначе можно
  // не заметить, что reload не применился (или, хуже, попытаться reload-нуть
  // заведомо битый конфиг). systemctl reload сам по себе тоже не подменит
  // рабочий конфиг битым (nginx так не делает), но явный `nginx -t` даёт куда
  // понятнее сообщение об ошибке, чем разбирать вывод systemctl.
  private async reload(): Promise<void> {
    await execAsync('nginx -t');
    await execAsync('systemctl reload nginx');
  }
}

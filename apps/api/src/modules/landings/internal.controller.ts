import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { LandingRendererService } from './landing-renderer.service';

// Вызывается Nginx (см. infra/nginx/sites/DOMAIN.conf, NginxService) для отдачи
// лендинга по клиентскому домену — proxy_pass http://api:3001/internal/serve-landing/:landingId$request_uri
@Controller('internal')
export class InternalController {
  constructor(private rendererService: LandingRendererService) {}

  @Public()
  @Get('serve-landing/:landingId')
  async serveLandingRoot(@Param('landingId') landingId: string, @Req() req: Request, @Res() res: Response) {
    this.assertFromNginx(req, res) && (await this.rendererService.renderAndServe(landingId, '', req, res));
  }

  // CUSTOM-лендинги (шаг 2.3) — несколько файлов (index.html + css/js/картинки), а не одна
  // страница как TEMPLATE; NginxService пробрасывает реальный путь через $request_uri,
  // здесь он попадает в Express-wildcard `req.params[0]`.
  @Public()
  @Get('serve-landing/:landingId/*')
  async serveLandingAsset(@Param('landingId') landingId: string, @Param('0') subPath: string, @Req() req: Request, @Res() res: Response) {
    this.assertFromNginx(req, res) && (await this.rendererService.renderAndServe(landingId, subPath, req, res));
  }

  // Один домен -> много лендингов/проектов через путь (2026-06-29, DomainPath) — единая точка
  // входа для ВСЕХ клиентских доменов (NginxService.renderTarget теперь домен-агностичен,
  // больше не знает про конкретный landingId). Host-заголовок + путь резолвятся в
  // LandingRendererService.renderByDomain. Оба маршрута (с * и без) — по аналогии с
  // serve-landing выше: для корневого запроса $request_uri="/" даёт "serve-by-domain/" с
  // ведущим слешем, что попадает в wildcard-вариант с пустым subPath, не в безслешевый.
  @Public()
  @Get('serve-by-domain')
  async serveByDomainRoot(@Req() req: Request, @Res() res: Response) {
    this.assertFromNginx(req, res) && (await this.rendererService.renderByDomain(req.headers.host || '', '/', req, res));
  }

  @Public()
  @Get('serve-by-domain/*')
  async serveByDomainAsset(@Param('0') subPath: string, @Req() req: Request, @Res() res: Response) {
    this.assertFromNginx(req, res) &&
      (await this.rendererService.renderByDomain(req.headers.host || '', `/${subPath}`, req, res));
  }

  // Доп. защита: принимать только от Nginx (localhost) — снаружи этот путь
  // не должен быть напрямую достижим, минуя домен-роутинг.
  private assertFromNginx(req: Request, res: Response): boolean {
    const remoteAddr = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr || '')) {
      res.status(403).send('Forbidden');
      return false;
    }
    return true;
  }
}

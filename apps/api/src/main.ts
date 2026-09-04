import dns from 'dns';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Сервер не имеет реального IPv6-маршрута наружу (только link-local fe80:: на интерфейсах,
// `ip route get <telegram ipv6>` -> "Network is unreachable"), но с Node 17+ dns.lookup() по
// умолчанию отдаёт адреса в порядке 'verbatim' (как вернул DNS-сервер), а не 'ipv4first' как
// раньше — если Telegram (или любой другой внешний хост с AAAA-записью) в какой-то момент
// вернёт IPv6-адрес первым, соединение падает мгновенно (ENETUNREACH), и grammy оборачивает
// это в непрозрачное "Network request for 'getMe' failed!". Это и есть причина бага
// 2026-08-25 "показывается на всех проектах разом" — ChannelsService.checkAllChannelsHealth()
// (крон раз в 15 минут) последовательно бьёт getMe() по каждому активному каналу без ретраев
// и мгновенно ставит isActive:false при первой же неудаче, так что один "невезучий" verbatim-
// порядок резолвинга валит сразу несколько каналов в одном тике. Форсируем ipv4first глобально
// (единственная реальная сетевая опция на этом сервере) — стандартный фикс именно этой node 17+
// регрессии, не костыль под конкретный клиент/либу.
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  // rawBody:true — нужен для HMAC-проверки серверного tracking-эндпоинта:
  // подпись должна проверяться против исходных байт запроса, а не против
  // JSON.stringify(распарсенного тела) — это два разных значения (порядок ключей,
  // числовая нормализация и т.п.), и проверка по re-serialized body была бы багом.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // crossOriginResourcePolicy: 'cross-origin' — helmet-дефолт 'same-origin' блокировал
  // (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) картинки, которые API намеренно отдаёт на чужие
  // origin: аватарки лендингов встраиваются на клиентских доменах (jcywkdake.shop и т.п.),
  // аватар канала — на дашборде (другой поддомен, mw-track.com vs api.mw-track.com).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());

  // origin:true (отражает Origin запроса, без credentials) — фиксированный ALLOWED_ORIGINS
  // (дашборд) не может покрыть клиентские домены, на которых встроен tracking SDK: это
  // self-service Domain-ы, добавляемые пользователями динамически (см. DomainsModule), их
  // набор в принципе не перечислим заранее. credentials:true убран — ни дашборд, ни SDK нигде
  // не используют cookie/withCredentials (везде Bearer JWT в заголовке, см. apps/web/src/lib/api.ts),
  // так что открытый origin здесь не открывает доступ к чьей-либо сессии.
  app.enableCors({
    origin: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger документация
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('TrafficCRM API').setVersion('1.0').addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(process.env.PORT || 3001);
}
bootstrap();

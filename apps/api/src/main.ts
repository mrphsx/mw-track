import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

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

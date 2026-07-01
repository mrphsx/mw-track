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

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
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

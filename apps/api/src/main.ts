import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '100mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '100mb' });
  app.enableCors({
    origin: ['http://localhost:3000'],
    credentials: true,
  });
  await app.listen(4000);
  // eslint-disable-next-line no-console
  console.log('API listening on http://localhost:4000');
}

bootstrap();

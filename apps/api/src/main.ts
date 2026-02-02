import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:3000'],
    credentials: true,
  });
  await app.listen(4000);
  // eslint-disable-next-line no-console
  console.log('API listening on http://localhost:4000');
}

bootstrap();

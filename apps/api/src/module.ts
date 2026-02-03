import { Module } from '@nestjs/common';
import { HealthController } from './routes/health.controller.js';
import { RecognizeController } from './routes/recognize.controller.js';
import { PricesController } from './routes/prices.controller.js';
import { CardService } from './services/card.service.js';
import { PriceService } from './services/price.service.js';
import { PrismaService } from './services/prisma.service.js';

@Module({
  controllers: [HealthController, RecognizeController, PricesController],
  providers: [PrismaService, CardService, PriceService],
})
export class AppModule {}

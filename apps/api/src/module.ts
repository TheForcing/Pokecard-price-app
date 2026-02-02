import { Module } from '@nestjs/common';
import { HealthController } from './routes/health.controller.js';
import { RecognizeController } from './routes/recognize.controller.js';
import { PricesController } from './routes/prices.controller.js';

@Module({
  controllers: [HealthController, RecognizeController, PricesController],
})
export class AppModule {}

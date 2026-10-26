import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HOST, JWT_SECRET_IS_DEFAULT, PORT } from './common/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // whitelist: unknown body keys are dropped, so contract additions stay backward compatible.
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  if (JWT_SECRET_IS_DEFAULT && process.env.NODE_ENV === 'production') {
    Logger.warn(
      'JWT_SECRET is unset — signing with the built-in dev secret. Set JWT_SECRET in production.',
      'Bootstrap',
    );
  }

  // PrismaService.onModuleInit applies the schema (PRISMA_AUTO_PUSH) during init.
  await app.listen(PORT, HOST);
  Logger.log(`Archlast Cine API listening on http://${HOST}:${PORT}`, 'Bootstrap');
}

void bootstrap();

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

/** Mirrors main.ts so tests exercise the same pipes, guards and routing. */
export const createTestApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
  app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
};

/** Distinct number per test so per-number OTP throttles do not collide. */
export const randomIndianMobile = (): string =>
  `+91${9}${Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, '0')}`.slice(0, 13);

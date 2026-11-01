import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

function allowedOrigins() {
  const listed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (listed.length) return listed;
  if (process.env.NODE_ENV === 'production') return [];
  return DEV_ORIGINS;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ping'] });
  const allowed = allowedOrigins();
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
}
bootstrap();

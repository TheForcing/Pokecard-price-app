import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './module.js';

type RequestLike = {
  method: string;
  ip?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | null };
};

type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  removeHeader(name: string): void;
  status(code: number): { json(body: { message: string }): void };
  on(event: 'finish', listener: () => void): void;
};

type NextFunctionLike = () => void;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) return ['http://localhost:3000'];
  const origins = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return origins.length ? origins : ['http://localhost:3000'];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');

  const apiPort = parsePositiveInt(process.env.API_PORT, 4000);
  const apiHost = process.env.API_HOST?.trim() || '127.0.0.1';

  const bodyLimitMb = parsePositiveInt(process.env.API_BODY_LIMIT_MB, 10);
  const bodyLimit = `${bodyLimitMb}mb`;
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  const rateLimitWindowMs = parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
  const rateLimitMax = parsePositiveInt(process.env.API_RATE_LIMIT_MAX_REQUESTS, 120);
  const rateLimitMaxBuckets = parsePositiveInt(process.env.API_RATE_LIMIT_MAX_BUCKETS, 10_000);
  const ipBucket = new Map<string, { count: number; resetAt: number }>();

  function pruneRateLimitBuckets(now: number): void {
    for (const [ip, bucket] of ipBucket) {
      if (bucket.resetAt <= now) {
        ipBucket.delete(ip);
      }
    }

    if (ipBucket.size <= rateLimitMaxBuckets) {
      return;
    }

    const overflow = ipBucket.size - rateLimitMaxBuckets;
    let removed = 0;
    for (const [ip] of ipBucket) {
      ipBucket.delete(ip);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }

  app.use((req: RequestLike, res: ResponseLike, next: NextFunctionLike) => {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    const isHttps = typeof proto === 'string' && proto.toLowerCase() === 'https';

    res.removeHeader('x-powered-by');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  });

  app.use((req: RequestLike, res: ResponseLike, next: NextFunctionLike) => {
    const now = Date.now();
    pruneRateLimitBuckets(now);
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const clientIp =
      (typeof forwardedIp === 'string' ? forwardedIp.split(',')[0].trim() : undefined) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const bucket = ipBucket.get(clientIp);
    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + rateLimitWindowMs;
      ipBucket.set(clientIp, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', String(rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimitMax - 1)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      next();
      return;
    }

    res.setHeader('X-RateLimit-Limit', String(rateLimitMax));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateLimitMax - bucket.count - 1)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= rateLimitMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ message: 'too many requests' });
      return;
    }

    bucket.count += 1;
    next();
  });

  app.use((req: RequestLike, res: ResponseLike, next: NextFunctionLike) => {
    const requestId =
      typeof req.headers['x-request-id'] === 'string' &&
      req.headers['x-request-id'].trim().length > 0
        ? req.headers['x-request-id'].trim()
        : randomUUID();
    const start = Date.now();

    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const log = {
        event: 'http_request',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(log));
    });

    next();
  });

  app.enableCors({
    origin: parseOrigins(process.env.API_ALLOWED_ORIGINS),
    credentials: true,
  });
  await app.listen(apiPort, apiHost);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://${apiHost}:${apiPort}`);
}

bootstrap();

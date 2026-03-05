import { spawnSync } from 'node:child_process';
import net from 'node:net';

const DEFAULT_DATABASE_URL = 'postgresql://pokecard:pokecard@localhost:5432/pokecard';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseDatabaseAddress(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || '5432'),
    };
  } catch {
    throw new Error(`Invalid DATABASE_URL: ${databaseUrl}`);
  }
}

async function ensureDatabaseReachable(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, 4000);

    socket.once('connect', () => {
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(undefined);
    });

    socket.once('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  const { host, port } = parseDatabaseAddress(databaseUrl);

  console.log('[release-check] validating database reachability...');
  try {
    await ensureDatabaseReachable(host, port);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release-check] database unreachable at ${host}:${port}: ${message}`);
    console.error('[release-check] start infra first: pnpm docker:up');
    process.exit(1);
  }

  console.log('[release-check] preparing prisma schema...');
  run('pnpm', ['-C', 'apps/api', 'exec', 'prisma', 'db', 'push'], { DATABASE_URL: databaseUrl });

  console.log('[release-check] running fast tests...');
  run('pnpm', ['test'], {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  });

  console.log('[release-check] running db integration tests...');
  run('pnpm', ['test:integration'], {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    RUN_DB_INTEGRATION_TESTS: 'true',
  });

  console.log('[release-check] running OCR smoke tests...');
  run('pnpm', ['ocr:manual'], {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  });

  console.log('[release-check] running typecheck and build...');
  run('pnpm', ['typecheck']);
  run('pnpm', ['build']);

  console.log('[release-check] running web e2e tests...');
  run('pnpm', ['-C', 'apps/web', 'test:e2e'], {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
  });

  console.log('[release-check] PASS: release readiness checks completed.');
}

await main();

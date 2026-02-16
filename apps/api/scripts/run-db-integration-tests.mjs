import { spawnSync } from 'node:child_process';
import net from 'node:net';

function ensureDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required for DB integration tests.');
    process.exit(1);
  }

  return databaseUrl;
}

async function ensureDatabaseReachable(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const port = Number(parsed.port || '5432');

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    }, 3000);

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
  const databaseUrl = ensureDatabaseUrl();

  try {
    await ensureDatabaseReachable(databaseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`Database is not reachable for integration tests: ${message}`);
    process.exit(1);
  }

  const env = {
    ...process.env,
    RUN_DB_INTEGRATION_TESTS: 'true',
  };

  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/db-integration.test.ts'], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

await main();

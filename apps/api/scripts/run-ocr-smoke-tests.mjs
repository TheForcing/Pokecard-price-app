import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  RUN_OCR_PIPELINE_SMOKE: 'true',
};

const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/recognize-pipeline.smoke.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

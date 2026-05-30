if (process.env.SKIP_PRISMA_GENERATE === '1') {
  console.log('Skipping prisma generate because SKIP_PRISMA_GENERATE=1');
  process.exit(0);
}

const { spawnSync } = await import('node:child_process');

const command = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const result = spawnSync(command, ['generate'], { stdio: 'inherit', shell: true });

process.exit(result.status ?? 1);

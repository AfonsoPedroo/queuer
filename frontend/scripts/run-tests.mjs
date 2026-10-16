import { spawn } from 'node:child_process';

const heap = '--max-old-space-size=6144';
const existing = process.env.NODE_OPTIONS ?? '';
const child = spawn('npx', ['ng', 'test', '--watch=false', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NODE_OPTIONS: existing.includes('max-old-space-size') ? existing : `${existing} ${heap}`.trim(),
  },
});
child.on('exit', (code) => process.exit(code ?? 1));

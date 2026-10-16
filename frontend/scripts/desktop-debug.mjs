import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const debugPort = process.env.QUEUER_DEBUG_PORT ?? '9222';
const devPort = process.env.QUEUER_DEV_PORT;
const args = ['tauri', 'dev'];

if (devPort && devPort !== '4200') {
  const base = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const override = {
    build: {
      devUrl: `http://localhost:${devPort}`,
      beforeDevCommand: `npm start -- --port ${devPort}`,
    },
    app: { security: { devCsp: String(base.app.security.devCsp).replaceAll('4200', devPort) } },
  };
  const file = join(tmpdir(), 'queuer-dev-port.conf.json');
  writeFileSync(file, JSON.stringify(override));
  args.push('--config', `"${file}"`);
}

const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
});
child.on('exit', (code) => process.exit(code ?? 0));

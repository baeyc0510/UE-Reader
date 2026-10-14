import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

// Files are copied as-is (asar disabled). A running UE Reader can keep the old copies locked,
// so verify the packaged app matches the sources instead of trusting the builder's exit code.
async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
async function verify() {
  const stale = [];
  for (const folder of ['server', 'dist', 'desktop']) {
    for (const file of await files(folder)) {
      const packaged = path.join('release', 'win-unpacked', 'resources', 'app', file);
      const [a, b] = await Promise.all([fs.readFile(file), fs.readFile(packaged).catch(() => null)]);
      if (!b || !a.equals(b)) stale.push(file);
    }
  }
  return stale;
}

// Use the bundled runtime so packaging does not depend on the installed Node version.
const child = spawn(electron, ['scripts/build-electron.cjs', '--win', '--dir'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', async code => {
  const stale = await verify();
  if (stale.length) {
    console.error(`\n배포본이 소스와 다릅니다 (${stale.length}개 파일, 예: ${stale.slice(0, 3).join(', ')}). 실행 중인 UE Reader를 종료한 뒤 다시 패키징하세요.`);
    process.exitCode = 1;
  } else process.exitCode = code ?? 1;
});

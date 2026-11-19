// pnpm start: 의존성이 없거나 바뀌었을 때만 설치하고, 목 백엔드로 개발 서버를 켠다.
// 이미 설치돼 있으면 설치를 건너뛰고 vite 를 바로 띄워(turbo 없이) 여러 번 켜도 빠르다. 뒤에 붙인 인자는 vite 로 넘긴다(예: pnpm start --host).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'admin');
/** pnpm 11 이 도는 가장 낮은 Node(그 아래는 node:sqlite 가 없어 pnpm 이 켜지지 않는다). */
const MIN_NODE = [22, 13];
/** 마지막으로 설치한 의존성 목록의 해시. 같으면 설치를 건너뛴다. */
const STAMP = join(ROOT, 'node_modules', '.simai-demo-installed');
const VITE = join(APP, 'node_modules', 'vite', 'bin', 'vite.js');

const log = (text) => console.log(`[simAI-DEMO] ${text}`);

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return;
  console.error(
    `[simAI-DEMO] Node ${process.versions.node} 로는 켤 수 없습니다. Node ${MIN_NODE.join('.')} 이상(24 LTS 권장)을 쓰세요.`,
  );
  process.exit(1);
}

/** 설치 결과를 바꾸는 파일(잠금 파일·워크스페이스·각 package.json)의 해시. */
function depsHash() {
  const files = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    ...['apps', 'packages'].flatMap((dir) =>
      readdirSync(join(ROOT, dir)).map((name) => join(dir, name, 'package.json')),
    ),
  ];
  const hash = createHash('sha256').update(`${process.platform}-${process.arch}`);
  for (const file of files) {
    const path = join(ROOT, file);
    if (existsSync(path)) hash.update(file).update(readFileSync(path));
  }
  return hash.digest('hex');
}

/** 이 스크립트를 부른 pnpm 으로 설치한다(packageManager 로 맞춘 버전). pnpm 밖에서 불렸으면 PATH 의 pnpm. */
function runPnpmInstall() {
  const args = ['install', '--frozen-lockfile', '--prefer-offline'];
  const pnpm = process.env.npm_execpath;
  if (pnpm && /pnpm/i.test(pnpm) && /\.[cm]?js$/.test(pnpm)) {
    return spawnSync(process.execPath, [pnpm, ...args], { cwd: ROOT, stdio: 'inherit' });
  }
  const command = pnpm && /pnpm/i.test(pnpm) ? `"${pnpm}"` : 'pnpm';
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });
}

function ensureDeps() {
  const want = depsHash();
  const have = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : null;
  if (have === want && existsSync(VITE)) return;
  log(have === null ? '처음 실행이라 의존성을 설치합니다' : '의존성이 바뀌어 다시 설치합니다');
  const result = runPnpmInstall();
  if (result.status !== 0) process.exit(result.status ?? 1);
  mkdirSync(dirname(STAMP), { recursive: true });
  writeFileSync(STAMP, want);
}

checkNode();
ensureDeps();
log('개발 서버를 켭니다. demo / demo 로 로그인하세요(끄기: Ctrl+C)');
const vite = spawn(process.execPath, [VITE, ...process.argv.slice(2)], {
  cwd: APP,
  stdio: 'inherit',
});
vite.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => vite.kill(signal));

// 반입용 번들 생성 → 폐쇄망에서 설치 없이 실행
//   node tools/bundle.mjs                 기본(경량): Node 런타임만 동봉. 브라우저는 PC 의 Chrome/Edge 사용 (Windows 는 Edge 기본 내장)
//   node tools/bundle.mjs --browser       Chromium 까지 동봉 (Chrome/Edge 가 없는 서버·리눅스용). headless-shell 은 제외
//   node tools/bundle.mjs --no-runtime    Node 런타임 제외 (대상 PC 에 Node 20+ 가 정식 설치된 경우, ~4MB. Playwright 1.62 = Node>=20)
//   node tools/bundle.mjs --no-scripts    실행용 .bat/.sh/bin 까지 제외 → zip 에 스크립트 0개. 실행은 `node cli.js` (README "반입 후 실행")
//   node tools/bundle.mjs --no-scenarios  시나리오 JSON 제외 (example.json 만 포함) — 계정정보 반입 심사 회피
//   node tools/bundle.mjs --all           win/linux/mac 런타임 전부
//   node tools/bundle.mjs --node 22.12.0  Node 버전 지정
// 결과: dist/wigo-web-tester-<os>[-browser][-noruntime]-<날짜>.zip + SHA256SUMS.txt (zip 안팎)
// 보안: 백신 오탐 소지가 있는 스크립트(playwright-core/bin/*.ps1, *.sh, xdg-open)는 런타임에 쓰지 않으므로 제거
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NODE_VER = args.includes('--node') ? args[args.indexOf('--node') + 1] : process.versions.node;
const ALL = args.includes('--all');
const WITH_BROWSER = args.includes('--browser');
const NO_RUNTIME = args.includes('--no-runtime');
const NO_SCENARIOS = args.includes('--no-scenarios');
const NO_SCRIPTS = args.includes('--no-scripts');
const TARGETS = { win: `win-x64`, linux: `linux-x64`, mac: process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64' };
const cur = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const wanted = ALL ? Object.keys(TARGETS) : [cur];
const dist = path.join(ROOT, 'dist');
const tmp = path.join(dist, '_tmp');
const stage = path.join(dist, '_stage');
fs.mkdirSync(tmp, { recursive: true });

const walk = (d, fn) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f, fn) : fn(f); } };
const MB = (p) => { let s = 0; if (fs.existsSync(p)) fs.statSync(p).isDirectory() ? walk(p, (f) => (s += fs.statSync(f).size)) : (s = fs.statSync(p).size); return (s / 1048576).toFixed(0); };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function download(url, to) {
  console.log(`⬇ ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}

// ----- 1. Node 런타임 -----
if (!NO_RUNTIME) for (const os of wanted) {
  const outDir = path.join(ROOT, 'runtime', os);
  const bin = path.join(outDir, os === 'win' ? 'node.exe' : 'node');
  if (fs.existsSync(bin)) { console.log(`✓ runtime/${os} 이미 있음`); continue; }
  const ext = os === 'win' ? 'zip' : 'tar.gz';
  const name = `node-v${NODE_VER}-${TARGETS[os]}`;
  const archive = path.join(tmp, `${name}.${ext}`);
  await download(`https://nodejs.org/dist/v${NODE_VER}/${name}.${ext}`, archive);
  fs.mkdirSync(outDir, { recursive: true });
  if (ext === 'zip') execSync(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${archive}' -DestinationPath '${tmp}'"`, { stdio: 'inherit' });
  else execSync(`tar -xzf "${archive}" -C "${tmp}"${process.platform === 'win32' ? ' --force-local' : ''}`, { stdio: 'inherit' });
  fs.copyFileSync(path.join(tmp, name, os === 'win' ? 'node.exe' : 'bin/node'), bin);
  if (os !== 'win') fs.chmodSync(bin, 0o755);
  console.log(`✓ runtime/${os}/${path.basename(bin)}`);
}

// ----- 2. Chromium (--browser 일 때만, 현재 OS) -----
const browsers = path.join(ROOT, 'browsers');
if (WITH_BROWSER) {
  const has = fs.existsSync(browsers) && fs.readdirSync(browsers).some((d) => /^chromium-\d+/.test(d));
  if (has) console.log('✓ browsers/ 이미 있음');
  else {
    console.log('⬇ Chromium (playwright install chromium --no-shell)');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium', '--no-shell'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } });
    if (r.status !== 0) throw new Error('playwright install 실패');
  }
  for (const d of fs.readdirSync(browsers)) {
    if (/^chromium_headless_shell|^ffmpeg/.test(d)) { fs.rmSync(path.join(browsers, d), { recursive: true, force: true }); console.log(`✂ browsers/${d} 제거`); }
  }
}

// ----- 3. 스테이징 (포함 목록 복사 → 불필요/오탐 소지 파일 제거) -----
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const include = ['bin', 'docs', 'node_modules', 'scenarios', 'src', 'ui', 'tools', 'cli.js', 'package.json', 'config.json', 'README.md', 'CLAUDE.md', 'WigoWebTester.bat', 'wigo-web-tester.sh', 'run.bat', 'run.sh']
  .concat(NO_RUNTIME ? [] : ['runtime']).concat(WITH_BROWSER ? ['browsers'] : []).filter((f) => fs.existsSync(path.join(ROOT, f)));
for (const f of include) fs.cpSync(path.join(ROOT, f), path.join(stage, f), { recursive: true, filter: (src) => !/[\\/]\.gui-profile([\\/]|$)/.test(src) });
// 시나리오: --no-scenarios 면 example 만
if (NO_SCENARIOS) for (const f of fs.readdirSync(path.join(stage, 'scenarios'))) if (f !== 'example.json') fs.rmSync(path.join(stage, 'scenarios', f), { recursive: true, force: true });
// 백신 오탐·반입 심사 소지 스크립트 제거 — 런타임에 쓰지 않는 것만 (2026-09-04: .cmd·.bin·시나리오 보조 bat·타 OS 런처까지 확대)
const removed = [];
const rm = (f) => { if (fs.existsSync(f)) { fs.rmSync(f, { recursive: true, force: true }); removed.push(path.relative(stage, f)); } };
rm(path.join(stage, 'node_modules', '.bin'));                                   // npm CLI shim(playwright.cmd 등) — 도구가 호출하지 않음
walk(path.join(stage, 'node_modules'), (f) => { if (/\.(ps1|sh|cmd|bat)$/.test(f) || /[\\/]xdg-open$/.test(f)) rm(f); });
walk(path.join(stage, 'scenarios'), (f) => { if (/\.(bat|cmd|sh|ps1)$/.test(f)) rm(f); });  // 시나리오 폴더 보조 스크립트 — 폴더 일괄 실행으로 대체 가능
if (!ALL && cur === 'win') ['wigo-web-tester.sh', 'run.sh', 'bin/env.sh'].forEach((f) => rm(path.join(stage, f)));   // Windows 번들에 리눅스 런처 불필요
if (!ALL && cur !== 'win') ['WigoWebTester.bat', 'run.bat', 'bin/env.bat'].forEach((f) => rm(path.join(stage, f)));
if (NO_SCRIPTS) ['WigoWebTester.bat', 'run.bat', 'wigo-web-tester.sh', 'run.sh', 'bin'].forEach((f) => rm(path.join(stage, f)));   // 런처 전부 제외 → node cli.js 로 실행
console.log(`✂ 미사용 스크립트 ${removed.length}개 제거 (${removed.slice(0, 4).join(', ')} ...)`);

// ----- 4. SHA256 매니페스트 -----
const manifest = [];
walk(stage, (f) => manifest.push(`${sha256(f)}  ${path.relative(stage, f).split(path.sep).join('/')}`));
manifest.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), manifest.join('\n') + '\n', 'utf8');

// ----- 5. zip -----
const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const tag = `${ALL ? 'all' : cur}${WITH_BROWSER ? '-browser' : ''}${NO_RUNTIME ? '-noruntime' : ''}${NO_SCRIPTS ? '-noscripts' : ''}`;
const zip = path.join(dist, `wigo-web-tester-${tag}-${stamp}.zip`);
console.log('포함:', include.map((f) => `${f}(${MB(path.join(stage, f))}MB)`).join(' '));
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal"`, { stdio: 'inherit' });
else execSync(`cd "${stage}" && zip -qr "${zip}" .`, { stdio: 'inherit' });
fs.writeFileSync(`${zip}.sha256`, `${sha256(zip)}  ${path.basename(zip)}\n`, 'utf8');
fs.copyFileSync(path.join(stage, 'SHA256SUMS.txt'), `${zip}.SHA256SUMS.txt`);
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`\n✅ 번들 완료: ${zip} (${MB(zip)} MB)
   zip 해시: ${zip}.sha256   내부 파일 해시: ${zip}.SHA256SUMS.txt (zip 안에도 포함)
   ${NO_SCRIPTS ? '압축 풀고 그 폴더에서 `node cli.js` (GUI) — 스크립트 파일 없음, README "반입 후 실행" 참고' : '압축 풀고 WigoWebTester.bat / wigo-web-tester.sh 실행'}${WITH_BROWSER ? '' : '\n   ※ 브라우저 미동봉: 대상 PC 의 Chrome 또는 Edge 를 사용합니다'}${NO_RUNTIME ? '\n   ※ Node 미동봉: 대상 PC 에 Node 20+ 필요 (Playwright 1.62 요구)' : ''}${NO_SCENARIOS ? '\n   ※ 시나리오 미포함: 반입 후 GUI 에서 작성' : ''}`);

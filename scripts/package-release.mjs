import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 배포본은 작업 폴더가 아닌 확정된 커밋에서만 가져옵니다.
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const required = [
  'package.json', 'package-lock.json', '.gitignore', '.env.example',
  'DISTRIBUTION.md', 'THIRD_PARTY_NOTICES.md', 'AUTO_UPDATE.md', 'bot.js', 'start.bat',
  'utils/check_api.js', 'scripts/package-release.mjs',
  'scripts/update-law-mcp.mjs', 'scripts/update-law-mcp.test.mjs',
  '.github/workflows/update-law-mcp.yml',
  '.github/law-mcp-deployed-version.txt',
  'cloudflare/.dev.vars.example', 'cloudflare/.gitignore',
  'cloudflare/build.mjs', 'cloudflare/engine.js', 'cloudflare/engine.test.js',
  'cloudflare/evidence.js', 'cloudflare/evidence.test.js',
  'cloudflare/law-worker-cache.js', 'cloudflare/law-worker-config.js',
  'cloudflare/law-worker-kordoc.js', 'cloudflare/law.js',
  'cloudflare/package.json', 'cloudflare/package-lock.json',
  'cloudflare/worker.js', 'cloudflare/worker.test.js', 'cloudflare/wrangler.jsonc',
  'third_party/korean-law-mcp-LICENSE.txt', 'third_party/korean-law-mcp-NOTICE.txt',
];
const fixed = new Set(required);
const allowed = (name) => fixed.has(name)
  || /^(?:src|test)\/[^/]+\.js$/.test(name)
  || /^third_party\/[^/]+\.txt$/.test(name);

class PackageError extends Error {}
const fail = (message) => { throw new PackageError(message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function pathPresent(filename) {
  try { lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail('Git 조회에 실패했습니다. 저장소와 필요한 커밋을 확인하세요.');
  }
}

// 값 자체는 로그나 매니페스트에 남기지 않습니다.
function localPrivateValues() {
  const values = new Set();
  const denylistPath = path.join(root, '.local', 'distribution-denylist.json');
  if (existsSync(denylistPath)) {
    const denylist = JSON.parse(readFileSync(denylistPath, 'utf8'));
    if (!Array.isArray(denylist) || denylist.some(value => typeof value !== 'string' || !value)) {
      fail('로컬 배포 제외 목록의 형식을 확인하세요.');
    }
    for (const value of denylist) values.add(value);
  }
  for (const name of ['.env', '.dev.vars', 'cloudflare/.env', 'cloudflare/.dev.vars']) {
    const filename = path.join(root, name);
    if (!existsSync(filename)) continue;
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail('로컬 비밀 설정을 안전하게 확인할 수 없어 중단했습니다.');
    }
    const source = readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
    // dotenv의 따옴표, 주석, 여러 줄 값을 처리합니다.
    const assignments = /(?:^|\n)\s*(?:export\s+)?[\w.-]+\s*=\s*(?:"((?:\\.|[^"])*)"|'([^']*)'|([^\r\n]*))/g;
    for (const match of source.matchAll(assignments)) {
      let value = match[1] ?? match[2] ?? match[3].split('#', 1)[0].trim();
      if (match[1] !== undefined) {
        value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      }
      if (value.length >= 8) values.add(value);
    }
  }
  return [...values];
}

function checkContents(name, bytes, privateValues) {
  const text = bytes.toString('utf8');
  const secretPatterns = [
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bcfat_[A-Za-z0-9_-]{20,}\b/,
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    fail('배포 후보에서 비밀키 형식이 발견되었습니다: ' + name);
  }
  const folded = text.toLowerCase();
  if (privateValues.some((value) => text.includes(value)
    || folded.includes(value.toLowerCase())
    || text.includes(JSON.stringify(value).slice(1, -1)))) {
    fail('배포 후보에서 로컬 설정값 또는 운영자 식별자가 발견되었습니다: ' + name);
  }
}

function neutralWrangler(bytes) {
  const source = bytes.toString('utf8');
  // 현재 JSONC의 최상위 name 필드만 교체하고 나머지 바이트는 보존합니다.
  const pattern = /^([ \t]{2}"name"[ \t]*:[ \t]*)"(?:\\.|[^"\\\r\n])*"/gm;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    fail('wrangler.jsonc의 최상위 name 형식을 확인할 수 없어 중단했습니다.');
  }
  return Buffer.from(source.replace(pattern, '$1"my-lawyer-bot"'), 'utf8');
}

function ensureOutputDirectory(dirname) {
  if (!existsSync(dirname)) mkdirSync(dirname);
  const stat = lstatSync(dirname);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || path.relative(root, realpathSync(dirname)) !== 'dist') {
    fail('dist 경로가 저장소 내부의 일반 디렉터리가 아닙니다.');
  }
}

// 경로를 명령 문자열에 삽입하지 않고 환경변수로 전달합니다.
function makeAndVerifyZip(stage, zip) {
  const command = String.raw`
$ErrorActionPreference = 'Stop'
$stage = $env:LAWYER_PACKAGE_STAGE
$archive = $env:LAWYER_PACKAGE_ZIP
if (Test-Path -LiteralPath $archive) { throw '이미 존재하는 ZIP 파일입니다.' }
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$expected = [System.Collections.Generic.Dictionary[string,string]]::new([System.StringComparer]::Ordinal)
$prefix = [System.IO.Path]::GetFileName($stage) + '/'
foreach ($file in Get-ChildItem -LiteralPath $stage -File -Recurse -Force) {
  $relative = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
  $expected.Add($prefix + $relative, (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())
}
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    $entryName = $entry.FullName.Replace('\', '/')
    if (-not $expected.ContainsKey($entryName) -or -not $seen.Add($entryName)) {
      throw 'ZIP에 예상하지 못한 파일 또는 중복 파일이 있습니다.'
    }
    $stream = $entry.Open()
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
      $digest = [System.BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
      $hash.Dispose()
      $stream.Dispose()
    }
    if ($digest -cne $expected[$entryName]) { throw 'ZIP 내용의 SHA256이 일치하지 않습니다.' }
  }
  if ($seen.Count -ne $expected.Count) { throw 'ZIP에서 빠진 파일이 있습니다.' }
} finally {
  $zip.Dispose()
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: root, windowsHide: true, timeout: 120_000,
      env: { ...process.env, LAWYER_PACKAGE_STAGE: stage, LAWYER_PACKAGE_ZIP: zip },
      maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail('ZIP 생성 또는 내용 검증에 실패했습니다. 기존 산출물은 삭제하지 않았습니다.');
  }
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    fail('Node.js 22 이상이 필요합니다.');
  }
  if (process.platform !== 'win32') {
    fail('이 배포 스크립트는 Windows PowerShell 환경에서 실행하세요.');
  }
  const gitRoot = realpathSync(git(['rev-parse', '--show-toplevel']).toString('utf8').trim());
  if (path.relative(root, gitRoot) !== '') {
    fail('이 프로젝트 자체의 Git 저장소에서만 배포본을 만들 수 있습니다.');
  }
  const commit = git(['rev-parse', '--verify', 'HEAD^{commit}']).toString('utf8').trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) fail('커밋 식별자를 확인하지 못했습니다.');
  const shortCommit = git(['rev-parse', '--short=12', commit]).toString('utf8').trim();
  if (!/^[a-f0-9]{12,64}$/.test(shortCommit)) fail('짧은 커밋 식별자를 확인하지 못했습니다.');

  const records = git(['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0').filter(Boolean);
  const selected = [];
  for (const record of records) {
    const match = /^(\d+) (blob|tree|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(record);
    if (!match) fail('Git 파일 목록을 해석하지 못했습니다.');
    const [, mode, type, , name] = match;
    if (!allowed(name)) continue;
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      fail('배포 목록에 일반 파일이 아닌 항목이 있습니다: ' + name);
    }
    if (name.includes('\\') || name.split('/').some((part) => part === '.' || part === '..')) {
      fail('배포 목록의 경로가 올바르지 않습니다.');
    }
    selected.push(name);
  }
  selected.sort();
  const found = new Set(selected);
  const missing = required.filter((name) => !found.has(name));
  if (missing.length) fail('HEAD에 필수 배포 파일이 없습니다. 먼저 커밋하세요: ' + missing.join(', '));
  if (!selected.some((name) => name.startsWith('src/'))
    || !selected.some((name) => name.startsWith('test/'))) {
    fail('HEAD에 src 또는 test의 JavaScript 파일이 없습니다.');
  }

  const privateValues = localPrivateValues();
  const contents = new Map();
  for (const name of selected) {
    let bytes = git(['show', commit + ':' + name]);
    if (name === 'cloudflare/wrangler.jsonc') bytes = neutralWrangler(bytes);
    contents.set(name, bytes);
  }
  contents.set('README.md', Buffer.from([
    '# 텔레그램 법률봇',
    '',
    'Windows와 Node.js 22 이상에서 사용할 수 있는 소스 배포본입니다.',
    '설치, 개인 봇 설정, Cloudflare 배포 방법은 [배포 안내](DISTRIBUTION.md)를 참고하세요.',
    '',
    '외부 구성요소와 라이선스는 [외부 소프트웨어 고지](THIRD_PARTY_NOTICES.md)에 정리되어 있습니다.',
    '원본 커밋과 파일별 SHA256은 RELEASE-MANIFEST.json에서 확인할 수 있습니다.',
    '',
  ].join('\n'), 'utf8'));
  contents.set('CLOUDFLARE.md', Buffer.from([
    '# Cloudflare 설정',
    '',
    '설치와 배포는 [배포 안내](DISTRIBUTION.md)를 참고하세요.',
    '',
  ].join('\n'), 'utf8'));

  const manifest = {
    formatVersion: 1,
    sourceCommit: commit,
    generatedAt: new Date().toISOString(),
    description: '명시적 허용 목록으로 구성한 소스 배포본입니다.',
    changes: {
      'README.md': '배포본 전용 안내문 생성',
      'CLOUDFLARE.md': '배포본 전용 안내 링크 생성',
      'cloudflare/wrangler.jsonc': '최상위 name만 my-lawyer-bot으로 변경',
    },
    note: 'files는 이 매니페스트 자체를 제외한 배포 파일의 SHA256입니다.',
    files: [...contents].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({
      path: name, bytes: bytes.length, sha256: sha256(bytes),
    })),
  };
  contents.set('RELEASE-MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
  // 출력 폴더를 만들기 전에 모든 후보를 확인합니다.
  for (const [name, bytes] of contents) checkContents(name, bytes, privateValues);

  const distRoot = path.join(root, 'dist');
  const releaseName = 'telegram-lawyer-bot-' + shortCommit;
  const stage = path.join(distRoot, releaseName);
  const zip = stage + '.zip';
  const checksum = zip + '.sha256';
  for (const target of [stage, zip, checksum]) {
    if (pathPresent(target)) fail('동일 커밋의 산출물이 이미 있습니다. 덮어쓰거나 삭제하지 않습니다.');
  }
  ensureOutputDirectory(distRoot);
  mkdirSync(stage);
  for (const [name, bytes] of contents) {
    const filename = path.join(stage, ...name.split('/'));
    if (path.relative(stage, filename).startsWith('..')) fail('배포 경로가 범위를 벗어났습니다.');
    mkdirSync(path.dirname(filename), { recursive: true });
    // 새 일반 파일로 생성하므로 점으로 시작하는 예제 파일에도 숨김 속성을 붙이지 않습니다.
    writeFileSync(filename, bytes, { flag: 'wx' });
  }
  makeAndVerifyZip(stage, zip);
  const archiveHash = sha256(readFileSync(zip));
  writeFileSync(checksum, archiveHash + '  ' + path.basename(zip) + '\n', { flag: 'wx' });
  console.log('배포본 생성 및 ZIP 파일 목록·SHA256 검증을 완료했습니다.');
  console.log('원본 커밋: ' + commit);
  console.log('파일 수: ' + contents.size);
  console.log('폴더: dist/' + releaseName);
  console.log('ZIP: dist/' + releaseName + '.zip');
  console.log('SHA256: ' + archiveHash);
  console.log('작업 폴더의 미커밋 변경 사항은 배포본에 포함되지 않습니다.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof PackageError
    ? error.message
    : '배포본 생성 중 오류가 발생했습니다. 경로·권한을 확인하세요. 기존 파일은 삭제하지 않았습니다.');
  process.exitCode = 1;
}

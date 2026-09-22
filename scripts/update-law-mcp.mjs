import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'korean-law-mcp';
const REGISTRY = 'https://registry.npmjs.org/';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function releaseVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Expected an exact stable release version, received an invalid or prerelease version.');
  }
  return value;
}

export function compareVersions(left, right) {
  const a = releaseVersion(left).split('.').map(BigInt);
  const b = releaseVersion(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function deploymentNeeded({ target, deployed, force = false }) {
  releaseVersion(target);
  if (deployed !== null) releaseVersion(deployed);
  return force || target !== deployed;
}

// Reused by the commit job: only the selected dependency may change in package.json.
export function validateCandidate(original, candidate, lock, target) {
  releaseVersion(target);
  if (candidate.dependencies?.[PACKAGE] !== target ||
      lock.packages?.['']?.dependencies?.[PACKAGE] !== target ||
      lock.packages?.[`node_modules/${PACKAGE}`]?.version !== target) {
    throw new Error('The manifest and lockfile do not pin the expected korean-law-mcp version.');
  }
  const before = structuredClone(original);
  const after = structuredClone(candidate);
  delete before.dependencies[PACKAGE];
  delete after.dependencies[PACKAGE];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Unexpected package.json changes outside korean-law-mcp; refusing this update.');
  }
}

function npmCommand() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find(value => value && path.basename(value) === 'npm-cli.js' && existsSync(value));
  if (cli) return [process.execPath, [cli]];
  if (process.platform === 'win32') {
    throw new Error('Cannot locate npm-cli.js. Run this script through npm run mcp:update.');
  }
  return ['npm', []];
}

export function runNpm(args, { cwd, capture = false } = {}) {
  const [command, prefix] = npmCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd, shell: false, windowsHide: true,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`npm ${args[0]} failed (exit ${code}).${capture ? ' ' + stderr.trim().slice(-1000) : ''}`));
    });
  });
}

export async function updateLawMcp({
  root = PROJECT_ROOT, run = runNpm, checkOnly = false, verifyCurrent = false,
  requestedTarget = null, log = console.log,
} = {}) {
  const manifestPath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const originalManifest = await readFile(manifestPath);
  const originalLock = await readFile(lockPath);
  const manifest = JSON.parse(originalManifest);
  const current = releaseVersion(manifest.dependencies?.[PACKAGE]);
  const raw = await run(['view', `${PACKAGE}@latest`, 'version', '--json', '--registry', REGISTRY], { cwd: root, capture: true });
  let latest;
  try { latest = releaseVersion(JSON.parse(raw)); }
  catch { throw new Error('npm registry did not return one valid stable latest version; nothing was changed.'); }
  const target = requestedTarget === null
    ? (compareVersions(latest, current) > 0 ? latest : current)
    : releaseVersion(requestedTarget);
  if (compareVersions(target, current) < 0) throw new Error('Automatic dependency downgrades are not allowed.');
  const changed = current !== target;
  const result = { current, latest, target, changed, validated: false };
  log(`${PACKAGE}: installed ${current}, registry latest ${latest}, selected ${target}`);
  if (checkOnly || (!changed && !verifyCurrent)) return result;

  const installFlags = ['--ignore-scripts', '--no-audit', '--no-fund'];
  try {
    if (changed) {
      await run(['install', `${PACKAGE}@${target}`, '--save-exact', '--registry', REGISTRY, ...installFlags], { cwd: root });
    } else {
      await run(['ci', ...installFlags], { cwd: root });
    }
    validateCandidate(manifest, JSON.parse(await readFile(manifestPath)), JSON.parse(await readFile(lockPath)), target);
    const cloudflare = path.join(root, 'cloudflare');
    await run(['ci', ...installFlags], { cwd: cloudflare });
    await run(['test', '--ignore-scripts'], { cwd: root });
    await run(['test', '--ignore-scripts'], { cwd: cloudflare });
    await run(['run', 'check', '--ignore-scripts'], { cwd: cloudflare });
    result.validated = true;
    log(`Validated ${PACKAGE}@${target}: root tests, Worker tests, and deployment dry-run passed.`);
    return result;
  } catch (error) {
    // Preserve the caller's original manifests, including any pre-existing local edits.
    await writeFile(manifestPath, originalManifest);
    await writeFile(lockPath, originalLock);
    throw new Error(`${error.message}\nOriginal package.json and package-lock.json restored. No deployment or commit was made by this script. Run npm ci --ignore-scripts to restore local node_modules if needed.`, { cause: error });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const known = args.every(arg => ['--check', '--verify-current'].includes(arg) || arg.startsWith('--target='));
  if (!known || args.filter(arg => arg.startsWith('--target=')).length > 1) {
    throw new Error('Usage: node scripts/update-law-mcp.mjs [--check] [--verify-current] [--target=X.Y.Z]');
  }
  const result = await updateLawMcp({
    checkOnly: args.includes('--check'), verifyCurrent: args.includes('--verify-current'),
    requestedTarget: args.find(arg => arg.startsWith('--target='))?.slice('--target='.length) ?? null,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

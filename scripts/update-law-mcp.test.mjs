import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, deploymentNeeded, releaseVersion, updateLawMcp, validateCandidate } from './update-law-mcp.mjs';

function manifest(version) {
  return { name: 'law-update-test', dependencies: { 'korean-law-mcp': version, other: '1.0.0' } };
}

function lockfile(version) {
  return { lockfileVersion: 3, packages: {
    '': { dependencies: manifest(version).dependencies },
    'node_modules/korean-law-mcp': { version },
  } };
}

async function fixture(t, current = '4.13.1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'law-mcp-update-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'cloudflare'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest(current), null, 2) + '\n');
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lockfile(current), null, 2) + '\n');
  return root;
}

function fakeNpm(root, latest, { failAt, tamper } = {}) {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, cwd: options.cwd });
    if (args[0] === 'view') return JSON.stringify(latest);
    if (args[0] === 'install') {
      const version = args[1].split('@')[1];
      const candidate = manifest(version);
      if (tamper) candidate.dependencies.other = '9.0.0';
      await writeFile(path.join(root, 'package.json'), JSON.stringify(candidate));
      await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lockfile(version)));
    }
    if (failAt?.(args, options)) throw new Error('Simulated command failure');
    return '';
  };
  return { run, calls };
}

test('only exact stable registry versions can become command arguments', () => {
  for (const value of ['latest', '^4.13.1', '4.13.1;echo secret', '4.13.1\nother=1', '4.14.0-beta.1', '04.0.0', {}, null]) {
    assert.throws(() => releaseVersion(value), /stable release/);
  }
  assert.equal(compareVersions('5.0.0', '4.999.999'), 1);
  assert.equal(compareVersions('4.14.0', '4.13.100'), 1);
  assert.equal(compareVersions('4.13.1', '4.13.1'), 0);
});

test('unchanged release is a registry-only no-op', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '4.13.1');
  const result = await updateLawMcp({ root, run: npm.run, log() {} });
  assert.equal(result.changed, false);
  assert.equal(result.validated, false);
  assert.equal(npm.calls.length, 1);
});

test('check-only detects a major release without installing or writing files', async t => {
  const root = await fixture(t);
  const original = await readFile(path.join(root, 'package.json'), 'utf8');
  const npm = fakeNpm(root, '5.0.0');
  const result = await updateLawMcp({ root, run: npm.run, checkOnly: true, log() {} });
  assert.equal(result.target, '5.0.0');
  assert.equal(result.changed, true);
  assert.equal(npm.calls.length, 1);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), original);
});

test('a major update pins the version and must pass both suites and build validation', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '5.0.0');
  const result = await updateLawMcp({ root, run: npm.run, log() {} });
  assert.equal(result.validated, true);
  assert.deepEqual(npm.calls.map(call => call.args[0]), ['view', 'install', 'ci', 'test', 'test', 'run']);
  assert.ok(npm.calls[1].args.includes('--save-exact'));
  for (const call of npm.calls.slice(1)) assert.ok(call.args.includes('--ignore-scripts'));
  assert.equal(npm.calls.at(-1).args[1], 'check');
  assert.equal(npm.calls.at(-1).cwd, path.join(root, 'cloudflare'));
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'))).dependencies['korean-law-mcp'], '5.0.0');
  assert.ok(npm.calls.every(call => !call.args.includes('deploy')));
});

test('root test failure restores both original files and never starts Worker tests or deployment', async t => {
  const root = await fixture(t);
  const before = await Promise.all(['package.json', 'package-lock.json'].map(name => readFile(path.join(root, name), 'utf8')));
  const npm = fakeNpm(root, '4.14.0', { failAt: (args, options) => args[0] === 'test' && options.cwd === root });
  await assert.rejects(updateLawMcp({ root, run: npm.run, log() {} }), /Original package.json and package-lock.json restored/);
  assert.deepEqual(npm.calls.map(call => call.args[0]), ['view', 'install', 'ci', 'test']);
  const after = await Promise.all(['package.json', 'package-lock.json'].map(name => readFile(path.join(root, name), 'utf8')));
  assert.deepEqual(after, before);
});

test('bundle failure is not reported as a validated update', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '4.14.0', { failAt: args => args[0] === 'run' });
  await assert.rejects(updateLawMcp({ root, run: npm.run, log() {} }), /Simulated command failure/);
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'))).dependencies['korean-law-mcp'], '4.13.1');
});

test('unexpected unrelated manifest mutation is refused before tests', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '4.14.0', { tamper: true });
  await assert.rejects(updateLawMcp({ root, run: npm.run, log() {} }), /Unexpected package.json changes/);
  assert.deepEqual(npm.calls.map(call => call.args[0]), ['view', 'install']);
});

test('a failed previous deployment can validate the current version without a version change', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '4.13.1');
  const result = await updateLawMcp({ root, run: npm.run, verifyCurrent: true, log() {} });
  assert.equal(result.changed, false);
  assert.equal(result.validated, true);
  assert.deepEqual(npm.calls.map(call => call.args[0]), ['view', 'ci', 'ci', 'test', 'test', 'run']);
});

test('a registry rollback never automatically downgrades installed code', async t => {
  const root = await fixture(t, '5.0.0');
  const npm = fakeNpm(root, '4.13.1');
  const result = await updateLawMcp({ root, run: npm.run, log() {} });
  assert.equal(result.target, '5.0.0');
  assert.equal(npm.calls.length, 1);
  await assert.rejects(updateLawMcp({ root, run: npm.run, requestedTarget: '4.13.1', log() {} }), /downgrades/);
});

test('a selected workflow target remains fixed if npm latest changes during validation', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, '5.0.0');
  const result = await updateLawMcp({ root, run: npm.run, requestedTarget: '4.14.0', log() {} });
  assert.equal(result.target, '4.14.0');
  assert.equal(npm.calls[1].args[1], 'korean-law-mcp@4.14.0');
});

test('invalid registry data does not install anything', async t => {
  const root = await fixture(t);
  const npm = fakeNpm(root, ['4.13.1', '5.0.0']);
  await assert.rejects(updateLawMcp({ root, run: npm.run, log() {} }), /one valid stable latest version/);
  assert.equal(npm.calls.length, 1);
});

test('success marker prevents daily redeployment and preserves failure retries', () => {
  assert.equal(deploymentNeeded({ target: '4.13.1', deployed: '4.13.1' }), false);
  assert.equal(deploymentNeeded({ target: '4.14.0', deployed: '4.13.1' }), true);
  assert.equal(deploymentNeeded({ target: '4.14.0', deployed: null }), true);
  assert.equal(deploymentNeeded({ target: '4.13.1', deployed: '4.13.1', force: true }), true);
  assert.throws(() => deploymentNeeded({ target: '4.13.1', deployed: 'invalid' }));
});

test('lockfile must pin the same installed target as the manifest', () => {
  assert.throws(() => validateCandidate(manifest('4.13.1'), manifest('4.14.0'), lockfile('4.13.1'), '4.14.0'), /do not pin/);
});

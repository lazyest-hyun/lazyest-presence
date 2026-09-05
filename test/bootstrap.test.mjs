import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {command} from '../src/presence.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (args, base) => spawnSync('/bin/bash', [path.join(root, 'bootstrap.sh'), ...args],
  {env: {...process.env, ...(base ? {LAZYEST_PRESENCE_HOME: base} : {})}, encoding: 'utf8'});
test('bootstrap help is readable before dependencies or authentication', () => {
  const result = run(['help']); assert.equal(result.status, 0); assert.match(result.stdout, /install/);
});
test('bootstrap rejects unknown commands without side effects', () => {
  assert.equal(run(['not-an-action']).status, 2);
});
test('bootstrap does not overwrite an unowned directory or follow a symlink', {skip: process.platform !== 'darwin'}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lazyest-presence-test-'));
  try {
    const keep = path.join(temp, 'keep.txt'); fs.writeFileSync(keep, 'do not change');
    const result = run(['prepare'], temp); assert.equal(result.status, 2);
    assert.equal(fs.readFileSync(keep, 'utf8'), 'do not change'); assert(!fs.existsSync(path.join(temp, '.owner')));
    const link = path.join(temp, 'link'); fs.symlinkSync(temp, link);
    assert.equal(run(['prepare'], link).status, 2);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
test('bootstrap refuses root and the user home as an installation directory', {skip: process.platform !== 'darwin'}, () => {
  assert.equal(run(['prepare'], '/').status, 2); assert.equal(run(['prepare'], os.homedir()).status, 2);
});
test('subprocess errors and timeouts are bounded without leaking environment values', async () => {
  const missing = await command('/not/a/real/program', []); assert.equal(missing.code, 1);
  const result = await command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 50);
  assert.equal(result.timedOut, true); assert.notEqual(result.code, 0);
});

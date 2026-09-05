import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {powerRequest, shouldRenewPower, lidEnabled, setLidEnabled} from '../src/power.mjs';

const now = new Date(2026, 7, 31, 10);
const fresh = {ok: true, action: 'renew', lastWriteAt: now.toISOString()};
test('power leases require enabled mode, a recent successful API write and the daily window', () => {
  assert.equal(shouldRenewPower(true, fresh, now), true);
  assert.equal(shouldRenewPower(false, fresh, now), false);
  for (const change of [{ok: false}, {action: 'battery_pause'}, {lastWriteAt: 'invalid'},
    {lastWriteAt: new Date(now.getTime() - 180000).toISOString()},
    {lastWriteAt: new Date(now.getTime() + 1000).toISOString()}]) {
    assert.equal(shouldRenewPower(true, {...fresh, ...change}, now), false);
  }
  assert.equal(shouldRenewPower(true, fresh, new Date(2026, 7, 31, 21)), false);
});
test('lid preference stays private, round trips and fails closed on corrupt data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-power-'));
  try {
    assert.equal(lidEnabled(dir), false); setLidEnabled(dir, true); assert.equal(lidEnabled(dir), true);
    const file = path.join(dir, 'lid.json'); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    setLidEnabled(dir, false); assert.equal(lidEnabled(dir), false);
    fs.writeFileSync(file, 'invalid'); assert.equal(lidEnabled(dir), false);
  } finally { fs.rmSync(dir, {recursive: true}); }
});
async function withServer(response, fn) {
  // Keep the socket path short enough for macOS sockaddr_un.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
  const socket = path.join(dir, 's');
  const requests = [];
  const server = net.createServer(client => client.once('data', data => {
    requests.push(JSON.parse(String(data))); client.end(response + '\n');
  }));
  try {
    await new Promise(resolve => server.listen(socket, resolve)); await fn(socket, requests);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true}); }
}
test('IPC sends only a limited operation and receives a bounded structured response', async () => {
  const value = {ok: true, active: true, reason: 'active', leaseRemainingSeconds: 179};
  await withServer(JSON.stringify(value), async (socket, requests) => {
    const result = await powerRequest('renew', socket);
    assert.equal(result.active, true); assert.deepEqual(requests, [{op: 'renew'}]);
  });
  await assert.rejects(powerRequest('run-shell'), {code: 'POWER_REQUEST'});
});
test('malformed, unbounded and arbitrary response text cannot leak through IPC', async () => {
  for (const response of ['not json', 'x'.repeat(5000), JSON.stringify({ok: true, active: false, reason: 'private-text', leaseRemainingSeconds: 10}),
    JSON.stringify({ok: true, active: true, reason: 'active', leaseRemainingSeconds: 999})]) {
    await withServer(response, async socket => { await assert.rejects(powerRequest('status', socket), {code: 'POWER_RESPONSE'}); });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_APP_ID, calendarEntries, withinSchedule, cycle, PresenceError,
  classifyCliError, safeError, launchPlist, sessionFresh} from '../src/core.mjs';

const config = {userId: 'user-a', connectedAs: 'tester@example.invalid', connectionName: 'test', appId: DEFAULT_APP_ID};
const identity = {...config, authType: 'browser', cloudType: 'Public'};
function local(day, hour, minute = 0, seconds = 0) { return new Date(2026, 7, day, hour, minute, seconds); }
function setup(date = local(31, 9), settings = {}) {
  const calls = [];
  const api = {
    identity: async () => { calls.push('identity'); return identity; },
    set: async (c, body) => { calls.push(['set', c.userId, body]); },
    clear: async (c, body) => { calls.push(['clear', c.userId, body]); },
    get: async () => { calls.push('get'); return {availability: 'Available', activity: 'Available'}; },
    ...settings.api
  };
  return {calls, args: {config, previous: settings.previous || {}, now: () => date, api,
    power: async () => ({batteryPercent: 60, onACPower: false, lidClosed: true, ...settings.power})}};
}
test('daily window boundaries include weekends', () => {
  assert.equal(withinSchedule(local(31, 7, 59, 59)), false);
  assert.equal(withinSchedule(local(31, 8)), true);
  assert.equal(withinSchedule(local(31, 20, 59, 59)), true);
  assert.equal(withinSchedule(local(31, 21)), false);
  assert.equal(withinSchedule(local(29, 12)), true);
  assert.equal(withinSchedule(local(30, 12)), true);
});
test('calendar has daily two-minute slots and one 21:00 cleanup', () => {
  const entries = calendarEntries();
  assert.equal(entries.length, 391);
  assert.equal(new Set(entries.map(x => JSON.stringify(x))).size, entries.length);
  assert(entries.every(x => x.Weekday === undefined));
  assert.equal(entries.filter(x => x.Hour === 21 && x.Minute === 0).length, 1);
  assert(entries.every(x => (x.Hour >= 8 && x.Hour < 21 && x.Minute % 2 === 0) || (x.Hour === 21 && x.Minute === 0)));
});
test('active cycle uses the installed own-user target and five-minute session', async () => {
  const {calls, args} = setup(); const result = await cycle(args);
  assert.equal(result.ok, true); assert.equal(result.lidClosed, true);
  assert.deepEqual(calls[1], ['set', 'user-a', {sessionId: DEFAULT_APP_ID, availability: 'Available', activity: 'Available', expirationDuration: 'PT5M'}]);
  assert.equal(result.availability, 'Available');
});
test('outside hours make zero auth or Graph requests when no owned session remains', async () => {
  for (const date of [local(31, 7), local(31, 22), local(29, 7)]) {
    const {calls, args} = setup(date); assert.equal((await cycle(args)).ok, true); assert.deepEqual(calls, []);
  }
});
test('21:00 clears once; subsequent cycles do not force user Offline', async () => {
  const {calls, args} = setup(local(31, 21), {previous: {lastWriteAt: local(31, 20, 58).toISOString()}});
  const result = await cycle(args);
  assert.deepEqual(calls[1], ['clear', 'user-a', {sessionId: DEFAULT_APP_ID}]);
  assert.equal(result.lastWriteAt, null); assert.equal(result.action, 'clear');
  calls.length = 0; await cycle({...args, previous: result}); assert.deepEqual(calls, []);
});
test('missing server session is successful cleanup rather than a retry loop', async () => {
  const {args} = setup(local(31, 21), {previous: {lastWriteAt: local(31, 20, 59).toISOString()},
    api: {clear: async () => { throw new PresenceError('NOT_FOUND', 'missing'); }}});
  const result = await cycle(args); assert.equal(result.ok, true); assert.equal(result.lastWriteAt, null);
});
test('account, application, auth type and cloud mismatch prevent every write', async () => {
  for (const change of [{connectedAs: 'someone-else@example.invalid'}, {appId: 'another-app'}, {connectionName: 'another'}, {authType: 'secret'}, {cloudType: 'China'}]) {
    const {calls, args} = setup(local(31, 9), {api: {identity: async () => ({...identity, ...change})}});
    const result = await cycle(args); assert.equal(result.error.code, 'ACCOUNT_CHANGED'); assert.deepEqual(calls, []);
  }
});
test('delayed authentication crossing 21:00 never sends a renew request', async () => {
  let date = local(31, 20, 59, 59);
  const {calls, args} = setup(date, {api: {identity: async () => { date = local(31, 21); return identity; }}});
  const result = await cycle({...args, now: () => date});
  assert.equal(result.ok, true); assert.equal(calls.some(x => Array.isArray(x) && x[0] === 'set'), false);
});
test('battery cutoff stops renewals and clears a fresh owned session; AC is exempt', async () => {
  for (const percent of [0, 19, 20]) {
    const {calls, args} = setup(local(31, 9), {previous: {lastWriteAt: local(31, 8, 59).toISOString()}, power: {batteryPercent: percent}});
    const result = await cycle(args); assert.equal(result.action, 'battery_pause'); assert.equal(calls[1][0], 'clear');
  }
  const {calls, args} = setup(local(31, 9), {power: {batteryPercent: 19, onACPower: true}});
  await cycle(args); assert.equal(calls[1][0], 'set');
});
test('failed read after successful write keeps expiry data for later cleanup', async () => {
  const {args} = setup(local(31, 9), {api: {get: async () => { throw new PresenceError('NETWORK', 'network unavailable'); }}});
  const result = await cycle(args); assert.equal(result.ok, false); assert.equal(result.lastWriteAt, local(31, 9).toISOString());
});
test('transient failures do not change credentials; subsequent cycle recovers', async () => {
  const {args} = setup(local(31, 9), {api: {set: async () => { throw classifyCliError('ECONNRESET'); }}});
  const failed = await cycle(args); assert.equal(failed.ok, false); assert.equal(failed.error.code, 'NETWORK');
  const next = setup(local(31, 9, 2), {previous: failed}); assert.equal((await cycle(next.args)).ok, true);
});
test('raw authentication errors and synthetic secret strings never reach state', async () => {
  const secret = 'FAKE_TEST_SECRET_DO_NOT_RETAIN';
  const {args} = setup(local(31, 9), {api: {identity: async () => { throw Error(secret); }}});
  const result = await cycle(args); assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(safeError(classifyCliError('403 ' + secret))).includes(secret), false);
  assert.equal(classifyCliError('AADSTS65001 ' + secret).code, 'AADSTS65001');
});
test('history remains bounded and preserves observed non-Available precedence', async () => {
  const {args} = setup(local(31, 9), {previous: {history: Array.from({length: 40}, (_, i) => ({i}))}, api: {get: async () => ({availability: 'Busy', activity: 'InACall'})}});
  const result = await cycle(args); assert.equal(result.history.length, 16); assert.equal(result.availability, 'Busy');
});
test('expired and malformed timestamps never trigger cleanup; XML paths are escaped', () => {
  assert.equal(sessionFresh('not-a-date', local(31, 21)), false);
  assert.equal(sessionFresh(local(31, 20, 55).toISOString(), local(31, 21)), false);
  const output = launchPlist('/tmp/a & b/node', '/tmp/c<d>/script', '/tmp/e');
  assert(output.includes('a &amp; b')); assert(output.includes('c&lt;d&gt;')); assert(!output.includes('<key>StartInterval</key>'));
});

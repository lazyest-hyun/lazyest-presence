import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_APP_ID, installIdentity, PresenceError} from '../src/core.mjs';

const identity = {connectedAs: 'tester@example.invalid', connectionName: 'test-connection',
  appId: DEFAULT_APP_ID, appTenant: 'organizations', authType: 'browser', cloudType: 'Public'};
const profile = {id: 'test-user-id', userPrincipalName: identity.connectedAs};
function fixture() {
  const calls = [];
  let current = {...identity};
  return {calls, set: value => { current = value; }, args: {
    api: {identity: async () => current, profile: async () => { calls.push('profile'); return profile; }},
    login: async opts => { calls.push(['login', opts]); current = {...identity}; return current; }
  }};
}
test('existing working login is reused without new registration, permission requests, or login', async () => {
  const f = fixture(); const config = await installIdentity(f.args);
  assert.equal(config.appId, DEFAULT_APP_ID); assert.equal(config.userId, profile.id);
  assert.deepEqual(f.calls, ['profile']);
});
test('missing login uses the default browser login path exactly once', async () => {
  const f = fixture(); f.set('Logged out');
  await installIdentity(f.args); assert.deepEqual(f.calls, [['login', {}], 'profile']);
});
test('LOGIN_REQUIRED opens login but a real network or policy failure is not misdiagnosed', async () => {
  const f = fixture(); let first = true;
  f.args.api.identity = async () => { if (first) { first = false; throw new PresenceError('LOGIN_REQUIRED', 'login'); } return identity; };
  await installIdentity(f.args); assert.equal(f.calls[0][0], 'login');
  for (const code of ['NETWORK', 'AADSTS53003', 'PERMISSION_DENIED']) {
    const failed = fixture(); failed.args.api.identity = async () => { throw new PresenceError(code, 'diagnose actual error'); };
    await assert.rejects(installIdentity(failed.args), {code}); assert.deepEqual(failed.calls, []);
  }
});
test('explicit account mismatch never silently binds the existing signed-in person', async () => {
  const f = fixture();
  await assert.rejects(installIdentity({...f.args, opts: {account: 'other@example.invalid'}}), {code: 'ACCOUNT_CHANGED'});
  assert.deepEqual(f.calls, []);
});
test('service identities, unsupported clouds, and incomplete connections are rejected before profile reads', async () => {
  for (const change of [{authType: 'secret'}, {cloudType: 'China'}, {connectionName: null}]) {
    const f = fixture(); f.set({...identity, ...change});
    await assert.rejects(installIdentity(f.args)); assert.deepEqual(f.calls, []);
  }
});
test('identity switching during profile lookup prevents binding to a different person', async () => {
  const f = fixture();
  f.args.api.profile = async () => { f.set({...identity, connectedAs: 'other@example.invalid'}); return profile; };
  await assert.rejects(installIdentity(f.args), {code: 'ACCOUNT_CHANGED'});
});
test('explicit tenant and app choices are passed only when the caller requested them', async () => {
  for (const opts of [{tenant: 'tenant.example.invalid'}, {'app-id': '11111111-1111-1111-1111-111111111111'}]) {
    const f = fixture();
    f.args.login = async received => { f.calls.push(['login', received]); const changed = {...identity,
      appTenant: opts.tenant || identity.appTenant, appId: opts['app-id'] || identity.appId}; f.set(changed); return changed; };
    await installIdentity({...f.args, opts}); assert.deepEqual(f.calls[0], ['login', opts]);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {installationPaths, childEnvironment} from '../src/paths.mjs';
import {publicFileIssues} from '../scripts/check-public.mjs';

test('paths derive from the installer source and current user, independent of the working directory', () => {
  const root = path.parse(process.cwd()).root;
  const home = path.join(root, 'sample-home');
  const source = path.join(root, 'checkout', 'src');
  const defaults = installationPaths(home, source);
  assert.equal(defaults.base, path.join(home, 'Library', 'Application Support', 'Lazyest Presence'));
  const relative = installationPaths(home, source, '../install with spaces');
  assert.equal(relative.base, path.join(root, 'install with spaces'));
  assert.equal(relative.installed, path.join(relative.base, 'app', 'presence.mjs'));
});
test('CLI child configuration isolates telemetry settings and suppresses inherited debug flags', () => {
  const paths = installationPaths(path.resolve('sample-home'), path.resolve('src'));
  const env = childEnvironment(paths, {PATH: '/usr/bin', CLIMICROSOFT365_DEBUG: '1', CLIMICROSOFT365_VERBOSE: '1', CLIMICROSOFT365_ENV: 'private-value'});
  assert.equal(env.XDG_CONFIG_HOME, paths.preferences);
  assert.equal(env.CLIMICROSOFT365_DEBUG, '0'); assert.equal(env.CLIMICROSOFT365_VERBOSE, '0');
  assert.equal(env.CLIMICROSOFT365_ENV, '');
});
test('public checks flag private values without echoing their content', () => {
  const examples = [path.join('/', 'Users', 'sample-account', 'file'),
    ['person', ['company', 'test'].join('.')].join('@'), 'ghp_' + 'a'.repeat(40)];
  for (const example of examples) {
    const findings = publicFileIssues('sample.md', example);
    assert(findings.length > 0); assert(!JSON.stringify(findings).includes(example));
  }
});
test('runtime files are blocked while reserved example addresses are permitted', () => {
  assert(publicFileIssues('outputs/report.json', '{}').length > 0);
  assert(publicFileIssues('state.json', '{}').length > 0);
  assert.deepEqual(publicFileIssues('README.md', 'me@example.com tester@example.invalid'), []);
});
test('Markdown ranges must not create accidental strike-through', () => {
  assert(publicFileIssues('README.md', '08~17 and 월~금').length > 0);
  assert.deepEqual(publicFileIssues('README.md', '08:00–21:00, 매일, \\~ and `~/Library`'), []);
});

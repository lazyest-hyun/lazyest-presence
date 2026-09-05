import path from 'node:path';

export function installationPaths(home, sourceDirectory, installRoot) {
  const base = installRoot
    ? path.resolve(sourceDirectory, '..', installRoot)
    : path.join(home, 'Library', 'Application Support', 'Lazyest Presence');
  const runtime = path.join(base, 'runtime');
  return {
    base, runtime,
    cli: path.join(runtime, 'cli', 'node_modules', '@pnp', 'cli-microsoft365', 'dist', 'index.js'),
    node: path.join(runtime, 'node', 'bin', 'node'),
    preferences: path.join(runtime, 'preferences'),
    plist: path.join(home, 'Library', 'LaunchAgents', 'com.lazyest.presence.plist'),
    installed: path.join(base, 'app', 'presence.mjs')
  };
}

export function childEnvironment(paths, inherited = process.env) {
  return {...inherited,
    PATH: `${path.dirname(paths.node)}:${inherited.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`,
    XDG_CONFIG_HOME: paths.preferences,
    CLIMICROSOFT365_DEBUG: '0', CLIMICROSOFT365_VERBOSE: '0', CLIMICROSOFT365_ENV: ''};
}

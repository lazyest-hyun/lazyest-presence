import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installationPaths, childEnvironment} from './paths.mjs';
import {powerStatus, syncPower, releasePower, maintainPower, setLidEnabled, POWER_EXECUTABLE} from './power.mjs';
import {DEFAULT_APP_ID, DEFAULT_TENANT, LABEL, SCHEDULE, PresenceError, safeError,
  classifyCliError, sameIdentity, withinSchedule, sessionFresh, launchPlist, cycle, installIdentity} from './core.mjs';

process.umask(0o077);
const SOURCE = path.dirname(fileURLToPath(import.meta.url));
const PATHS = installationPaths(os.homedir(), SOURCE, process.env.LAZYEST_PRESENCE_HOME);
export const BASE = PATHS.base;
const {runtime: RUNTIME, cli: CLI, node: NODE, plist: PLIST, installed: INSTALLED} = PATHS;
const RUNTIME_FILES = ['core.mjs', 'paths.mjs', 'power.mjs', 'presence.mjs'];
const POWER_FILES = ['native/PowerPolicy.swift', 'native/PresencePower.swift', 'native/PowerPolicyChecks.swift', 'scripts/build-power.sh'];
const TARGET = `gui/${process.getuid()}`;
const OWNER = path.join(BASE, '.owner');
const CONFIG = path.join(BASE, 'config.json');
const STATE = path.join(BASE, 'state.json');

function readJson(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw new PresenceError('STATE_INVALID', '설정 파일을 읽을 수 없습니다. doctor로 설치를 확인하세요.'); }
}
function saveJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(temp, file);
}
function ensureOwned() {
  if (BASE === '/' || BASE === os.homedir() || os.homedir().startsWith(BASE + path.sep)
      || fs.lstatSync(BASE).isSymbolicLink() || fs.readFileSync(OWNER, 'utf8').trim() !== 'lazyest-presence-v1') {
    throw new PresenceError('PATH_UNSAFE', '우리 설치 폴더로 확인되지 않아 변경하지 않았습니다.');
  }
}
export function command(executable, args, timeout = 45000, cwd) {
  return new Promise(resolve => {
    const child = spawn(executable, args, {cwd, env: childEnvironment(PATHS), stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    let killTimer;
    child.on('exit', () => clearTimeout(killTimer));
    child.on('error', () => { clearTimeout(timer); resolve({code: 1, stdout: '', stderr: 'Executable unavailable', timedOut: false}); });
    child.stdout.on('data', data => { if (stdout.length < 1024 * 1024) stdout += data; });
    child.stderr.on('data', data => { if (stderr.length < 1024 * 1024) stderr += data; });
    child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer); resolve({code: code ?? 1, stdout, stderr, timedOut}); });
    // All CLI invocations are bounded, including interrupted browser login.
    killTimer = setTimeout(() => { child.kill('SIGKILL'); }, timeout + 5000);
  });
}
async function m365(args, timeout) {
  const policy = readJson(path.join(PATHS.preferences, 'configstore', 'cli-m365-config.json'), {});
  if (policy.disableTelemetry !== true) throw new PresenceError('PRIVACY_SETUP', './bootstrap.sh prepare로 비공개 CLI 설정을 준비하세요.');
  const result = await command(NODE, [CLI, ...args, '--output', 'json', '--debug=false', '--verbose=false'], timeout, path.join(RUNTIME, 'cli'));
  if (result.code !== 0) throw classifyCliError(result.stdout + result.stderr, result.timedOut);
  try { return result.stdout.trim() ? JSON.parse(result.stdout) : null; }
  catch { throw new PresenceError('CLI_RESPONSE', 'CLI 응답 형식이 예상과 다릅니다. 원문은 저장하지 않았습니다.'); }
}
const api = {
  identity: () => m365(['status']),
  profile: () => m365(['request', '--url', 'https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName']),
  get: config => graph(config),
  set: (config, body) => graph(config, 'setPresence', body),
  clear: (config, body) => graph(config, 'clearPresence', body)
};
async function graph(config, operation, body) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.userId)}/presence${operation ? '/' + operation : ''}`;
  const args = ['request', '--url', url];
  if (operation) args.push('--method', 'post', '--content-type', 'application/json', '--body', JSON.stringify(body));
  return m365(args);
}
async function power() {
  const [battery, lid] = await Promise.all([
    command('/usr/bin/pmset', ['-g', 'batt'], 5000),
    command('/usr/sbin/ioreg', ['-r', '-k', 'AppleClamshellState', '-d', '4'], 5000)
  ]);
  const percent = battery.stdout.match(/(\d+)%/);
  const closed = lid.stdout.match(/"AppleClamshellState"\s*=\s*(Yes|No)/);
  return {batteryPercent: percent ? Number(percent[1]) : null,
    onACPower: battery.code === 0 ? battery.stdout.includes("'AC Power'") : null,
    lidClosed: closed ? closed[1] === 'Yes' : null};
}
async function loaded() { return (await command('/bin/launchctl', ['print', `${TARGET}/${LABEL}`], 10000)).code === 0; }
async function launch(args) {
  if ((await command('/bin/launchctl', args, 15000)).code !== 0) throw new PresenceError('LAUNCHD_FAILED', 'macOS 자동 실행 등록에 실패했습니다. 로그인된 데스크톱 세션인지 확인하세요.');
}
async function bootout() { if (await loaded()) await launch(['bootout', `${TARGET}/${LABEL}`]); }
async function withLock(fn) {
  ensureOwned();
  const lock = path.join(BASE, 'operation.lock');
  try { fs.writeFileSync(lock, String(process.pid), {flag: 'wx', mode: 0o600}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new PresenceError('LOCKED', '다른 설치 작업의 잠금 파일을 확인하세요.');
    try { process.kill(pid, 0); throw new PresenceError('LOCKED', '다른 설치·갱신 작업이 실행 중입니다. 잠시 후 다시 시도하세요.'); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, String(process.pid), {flag: 'wx', mode: 0o600});
  }
  try { return await fn(); }
  finally { try { fs.unlinkSync(lock); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (!['--app-id', '--tenant', '--account'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new PresenceError('ARGUMENT', '지원 옵션: --app-id APP_ID --tenant TENANT --account 본인메일');
    }
    result[args[i].slice(2)] = args[++i];
  }
  if (result['app-id'] && !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(result['app-id'])) throw new PresenceError('ARGUMENT', 'app-id 형식이 올바르지 않습니다.');
  if (result.tenant && !/^[a-z\d.-]+$/i.test(result.tenant)) throw new PresenceError('ARGUMENT', 'tenant 형식이 올바르지 않습니다.');
  return result;
}
async function login(opts) {
  console.log('Microsoft 로그인 창에서 본인 회사 계정을 선택하세요. 비밀번호·MFA는 직접 입력하며 AI에게 전달하지 마세요.');
  console.log('Microsoft Graph Command Line Tools 앱으로 브라우저 로그인을 진행합니다.');
  const result = await m365(['login', '--authType', 'browser', '--appId', opts['app-id'] || DEFAULT_APP_ID,
    '--tenant', opts.tenant || DEFAULT_TENANT], 300000);
  if (!result?.connectedAs) throw new PresenceError('LOGIN_REQUIRED', 'Microsoft 로그인이 완료되지 않았습니다.');
  if (opts.account && result.connectedAs.toLowerCase() !== opts.account.toLowerCase()) throw new PresenceError('ACCOUNT_CHANGED', '선택한 계정이 --account와 다릅니다. 본인 계정으로 다시 로그인하세요.');
  return result;
}
async function identityForInstall(opts) {
  return installIdentity({opts, api, login});
}
async function tick() {
  try { return await withLock(async () => {
    const state = await cycle({config: readJson(CONFIG), previous: readJson(STATE, {}), api, power});
    state.closedLid = await syncPower(BASE, state);
    saveJson(STATE, state);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'history'))));
    return state.ok ? 0 : 1;
  }); } catch (error) {
    // RunAtLoad can overlap the install preflight. The next calendar tick retries.
    if (error.code === 'LOCKED') return 0;
    throw error;
  }
}
async function install(opts) {
  return withLock(async () => {
    const config = await identityForInstall(opts);
    const oldConfig = readJson(CONFIG, null);
    if (oldConfig && (oldConfig.userId !== config.userId || oldConfig.appId !== config.appId)) {
      throw new PresenceError('ACCOUNT_CHANGED', '기존 설치의 계정·앱과 다릅니다. 기존 작업을 stop/uninstall한 뒤 새 계정으로 설치하세요.');
    }
    console.log('본인 계정 확인 완료. 계정 식별자는 출력하지 않습니다.');
    // Always check read access before installation. Write only during the requested window.
    await api.get(config);
    const initial = await cycle({config, previous: readJson(STATE, {}), api, power});
    if (!initial.ok) throw new PresenceError(initial.error.code, initial.error.message);
    const wasLoaded = await loaded();
    const app = path.join(BASE, 'app');
    const launcher = path.join(BASE, 'lazyest-presence');
    const files = [PLIST, CONFIG, STATE, launcher, ...RUNTIME_FILES.map(name => path.join(app, name)), ...POWER_FILES.map(name => path.join(BASE, name))];
    const backups = new Map(files.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
    fs.mkdirSync(app, {recursive: true, mode: 0o700});
    await bootout();
    try {
      // Runtime scripts live outside the clone, so a temporary checkout can be removed.
      for (const name of RUNTIME_FILES) {
        const target = path.join(app, name);
        if (path.resolve(SOURCE, name) !== path.resolve(target)) fs.copyFileSync(path.join(SOURCE, name), target);
        fs.chmodSync(target, 0o600);
      }
      for (const name of POWER_FILES) {
        const source = path.join(SOURCE, '..', name), target = path.join(BASE, name);
        fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
        if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
        fs.chmodSync(target, name.endsWith('.sh') ? 0o700 : 0o600);
      }
      saveJson(CONFIG, config);
      initial.closedLid = await syncPower(BASE, initial);
      saveJson(STATE, initial);
      fs.writeFileSync(launcher, '#!/bin/bash\nset -euo pipefail\nPRESENCE_ROOT="$(cd "$(dirname "$0")" && pwd)"\nexport LAZYEST_PRESENCE_HOME="$PRESENCE_ROOT"\nexec "$PRESENCE_ROOT/runtime/node/bin/node" "$PRESENCE_ROOT/app/presence.mjs" "$@"\n', {mode: 0o700});
      fs.mkdirSync(path.dirname(PLIST), {recursive: true});
      fs.writeFileSync(PLIST, launchPlist(NODE, INSTALLED, BASE), {mode: 0o600});
      await launch(['enable', `${TARGET}/${LABEL}`]);
      await launch(['bootstrap', TARGET, PLIST]);
    } catch (error) {
      await bootout();
      for (const [file, contents] of backups) {
        if (contents === null) fs.rmSync(file, {force: true});
        else fs.writeFileSync(file, contents, {mode: file === launcher || file.endsWith('.sh') ? 0o700 : 0o600});
      }
      // A successful preflight can leave a short session even if registration fails.
      saveJson(STATE, {...readJson(STATE, {}), lastWriteAt: initial.lastWriteAt});
      if (wasLoaded && backups.get(PLIST)) await launch(['bootstrap', TARGET, PLIST]);
      throw error;
    }
    console.log(JSON.stringify({installed: true, schedule: SCHEDULE, action: initial.action,
      writeVerified: initial.action === 'renew', availability: initial.availability ?? null,
      closedLid: await powerStatus(BASE),
      note: initial.action === 'renew' ? 'API 쓰기·조회 성공. 다른 사람의 Teams 화면은 별도 확인 대상입니다.' : '현재 시간·배터리 조건 때문에 온라인 쓰기는 다음 활성 구간에 확인합니다.'}, null, 2));
    return 0;
  });
}
async function status() {
  const config = readJson(CONFIG);
  const current = await api.identity();
  if (!sameIdentity(config, current)) throw new PresenceError('ACCOUNT_CHANGED', '설치된 계정과 현재 CLI 계정이 다릅니다. 다른 사람의 상태를 조회하지 않았습니다.');
  const presence = await api.get(config);
  const state = readJson(STATE, {});
  console.log(JSON.stringify({schedulerLoaded: await loaded(), schedule: SCHEDULE, withinSchedule: withinSchedule(new Date()),
    availability: presence.availability, activity: presence.activity, currentDevice: await power(),
    closedLid: await powerStatus(BASE), lastRun: state}, null, 2));
}
async function stop() {
  await launch(['disable', `${TARGET}/${LABEL}`]);
  await bootout();
  const powerCleanup = await releasePower();
  return withLock(async () => {
    const config = readJson(CONFIG, null), state = readJson(STATE, {});
    let cleanup = 'session_expired_or_absent';
    if (config && sessionFresh(state.lastWriteAt, new Date())) {
      try {
        if (!sameIdentity(config, await api.identity())) throw new PresenceError('ACCOUNT_CHANGED', '현재 CLI 계정이 달라 세션을 해제하지 않았습니다.');
        try { await api.clear(config, {sessionId: config.appId}); }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        state.lastWriteAt = null;
        cleanup = 'cleared';
      } catch (error) { cleanup = safeError(error).code + ': 자동 실행은 중지됐으며 마지막 세션은 5분 내 만료됩니다.'; }
    }
    saveJson(STATE, {...state, stoppedAt: new Date().toISOString(), cleanup});
    console.log(JSON.stringify({stopped: true, cleanup, powerCleanup}));
  });
}
async function doctor() {
  const report = {platform: process.platform, architecture: process.arch, runtimeReady: fs.existsSync(CLI),
    installed: fs.existsSync(CONFIG), schedulerLoaded: await loaded(),
    defaultApp: 'Microsoft Graph Command Line Tools (공개 앱 ID, 비밀키 아님)', schedule: SCHEDULE,
    closedLid: await powerStatus(BASE),
    note: '새 Microsoft 앱 등록·관리자 동의를 선행 조건으로 두지 않습니다. 내장 덮개 모듈 설치에는 macOS 승인이 필요합니다.'};
  if (report.runtimeReady) {
    try {
      const identity = await api.identity();
      report.signedIn = Boolean(identity?.connectedAs);
      if (report.signedIn) {
        report.authType = identity.authType;
        report.sameAsInstalled = !report.installed || sameIdentity(readJson(CONFIG), identity);
        if (['browser', 'deviceCode'].includes(identity.authType) && identity.cloudType === 'Public') {
          const profile = await api.profile();
          const presence = await api.get({userId: profile.id});
          report.graphRead = 'ok';
          report.availability = presence.availability;
          report.activity = presence.activity;
        }
      }
    } catch (error) { report.error = safeError(error); }
  }
  console.log(JSON.stringify(report, null, 2));
}
async function main() {
  if (process.platform !== 'darwin') throw new PresenceError('PLATFORM', '현재 macOS 전용입니다.');
  const [action, ...args] = process.argv.slice(2), opts = options(args);
  switch (action) {
    case 'doctor': await doctor(); break;
    case 'login': await login(opts); console.log('로그인 완료. install 또는 status로 확인하세요.'); break;
    case 'install': return install(opts);
    case 'tick': return tick();
    case 'status': await status(); break;
    case 'lid-setup':
      ensureOwned(); readJson(CONFIG);
      await maintainPower(BASE, 'install', command);
      setLidEnabled(BASE, true); await tick();
      // RunAtLoad may own the tick lock; the successful install preflight is still valid.
      await syncPower(BASE, readJson(STATE, {}));
      console.log(JSON.stringify(await powerStatus(BASE), null, 2)); break;
    case 'lid-on':
      ensureOwned(); readJson(CONFIG);
      if (!fs.existsSync(POWER_EXECUTABLE)) throw new PresenceError('POWER_UNAVAILABLE', '먼저 lid-setup을 실행하세요.');
      if (!await loaded()) throw new PresenceError('SCHEDULER_STOPPED', '먼저 start로 매일 스케줄을 재개하세요.');
      setLidEnabled(BASE, true); await tick();
      await syncPower(BASE, readJson(STATE, {}));
      console.log(JSON.stringify(await powerStatus(BASE), null, 2)); break;
    case 'lid-off':
      ensureOwned(); setLidEnabled(BASE, false);
      console.log(JSON.stringify(await releasePower())); break;
    case 'lid-status': console.log(JSON.stringify(await powerStatus(BASE), null, 2)); break;
    case 'lid-remove':
      ensureOwned(); setLidEnabled(BASE, false); await releasePower();
      await maintainPower(BASE, 'remove', command);
      fs.rmSync(path.join(BASE, 'lid.json'), {force: true});
      console.log('내장 덮개 모듈을 제거했습니다.'); break;
    case 'start':
      readJson(CONFIG);
      await launch(['enable', `${TARGET}/${LABEL}`]);
      if (!await loaded()) await launch(['bootstrap', TARGET, PLIST]);
      else await launch(['kickstart', `${TARGET}/${LABEL}`]);
      console.log('매일 스케줄을 켰습니다. 시간 외에는 온라인 상태를 만들지 않습니다.'); break;
    case 'stop': await stop(); break;
    case 'uninstall':
      ensureOwned(); await stop();
      await maintainPower(BASE, 'remove', command);
      fs.rmSync(PLIST, {force: true});
      fs.rmSync(BASE, {recursive: true});
      console.log('Lazyest Presence를 제거했습니다. 공용 Microsoft CLI 로그인은 변경하지 않았습니다.'); break;
    default: throw new PresenceError('ARGUMENT', './bootstrap.sh help를 확인하세요.');
  }
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code ?? 0; }).catch(error => {
    console.error(JSON.stringify({ok: false, error: safeError(error)})); process.exitCode = 1;
  });
}

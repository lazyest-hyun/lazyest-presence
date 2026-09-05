import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {PresenceError, withinSchedule} from './core.mjs';

export const POWER_LABEL = 'com.lazyest.presence.power';
export const POWER_EXECUTABLE = '/Library/PrivilegedHelperTools/' + POWER_LABEL;
export const POWER_SOCKET = '/var/run/' + POWER_LABEL + '/control.sock';
const REASONS = new Set(['active', 'outside_schedule', 'not_console_user', 'lease_expired', 'thermal_pause',
  'power_unknown', 'battery_pause', 'restore_failed', 'unsupported_system', 'external_sleep_setting', 'enable_failed']);

export function powerRequest(op, socketPath = POWER_SOCKET) {
  if (!['status', 'renew', 'release'].includes(op)) return Promise.reject(new PresenceError('POWER_REQUEST', '지원하지 않는 전원 요청입니다.'));
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let response = '', done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); client.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new PresenceError('POWER_TIMEOUT', '전원 모듈 응답 시간이 초과됐습니다.')), 4000);
    client.on('connect', () => client.write(JSON.stringify({op}) + '\n'));
    client.on('data', data => {
      response += data;
      if (response.length > 4096) return finish(new PresenceError('POWER_RESPONSE', '전원 모듈 응답이 올바르지 않습니다.'));
      if (!response.includes('\n')) return;
      try {
        const value = JSON.parse(response.slice(0, response.indexOf('\n')));
        if (typeof value.ok !== 'boolean' || typeof value.active !== 'boolean' || !REASONS.has(value.reason)
            || !Number.isInteger(value.leaseRemainingSeconds) || value.leaseRemainingSeconds < 0
            || value.leaseRemainingSeconds > 180) throw Error();
        finish(null, {ok: value.ok, installed: true, managedByPresence: true,
          active: value.active, reason: value.reason, leaseRemainingSeconds: value.leaseRemainingSeconds});
      } catch { finish(new PresenceError('POWER_RESPONSE', '전원 모듈 응답이 올바르지 않습니다.')); }
    });
    client.on('error', error => finish(new PresenceError(error.code === 'EACCES' ? 'POWER_PERMISSION' : 'POWER_UNAVAILABLE',
      '덮개 모듈에 연결할 수 없습니다. lid-setup으로 설치·권한을 확인하세요.')));
    client.on('end', () => { if (!done) finish(new PresenceError('POWER_RESPONSE', '전원 모듈 연결이 종료됐습니다.')); });
  });
}

export function lidEnabled(base) {
  try { return JSON.parse(fs.readFileSync(path.join(base, 'lid.json'), 'utf8')).enabled === true; }
  catch { return false; }
}

export function setLidEnabled(base, enabled) {
  const file = path.join(base, 'lid.json'), temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({enabled}) + '\n', {mode: 0o600}); fs.renameSync(temp, file);
}

export async function powerStatus(base) {
  const enabled = lidEnabled(base);
  try { return {...await powerRequest('status'), enabled}; }
  catch (error) { return {installed: fs.existsSync(POWER_EXECUTABLE), enabled, active: false,
    managedByPresence: true, reason: error.code, note: '내장 덮개 모듈 설정: ./bootstrap.sh lid-setup'}; }
}

export function shouldRenewPower(enabled, state, now = new Date()) {
  const age = now.getTime() - Date.parse(state.lastWriteAt);
  return enabled && state.ok === true && state.action === 'renew'
    && Number.isFinite(age) && age >= 0 && age < 180000 && withinSchedule(now);
}

export async function syncPower(base, state) {
  if (!fs.existsSync(POWER_EXECUTABLE)) return {installed: false, active: false};
  try { return await powerRequest(shouldRenewPower(lidEnabled(base), state) ? 'renew' : 'release'); }
  catch (error) { return {installed: true, active: false, reason: error.code}; }
}

export async function releasePower() {
  try { return await powerRequest('release'); }
  catch (error) { return {active: false, reason: error.code, note: '마지막 전원 갱신은 3분 내 만료됩니다.'}; }
}

export async function maintainPower(base, action, command) {
  if (!['install', 'remove'].includes(action)) throw new PresenceError('POWER_REQUEST', '지원하지 않는 전원 설정 작업입니다.');
  const binary = action === 'remove' ? POWER_EXECUTABLE : path.join(base, 'power', 'lazyest-presence-power');
  if (!fs.existsSync(binary)) {
    if (action === 'remove') return;
    const build = await command('/bin/bash', [path.join(base, 'scripts', 'build-power.sh')], 240000);
    if (build.code !== 0) throw new PresenceError('POWER_BUILD', 'Apple Command Line Tools 설치를 완료한 뒤 lid-setup을 다시 실행하세요.');
  }
  console.log('내장 덮개 모듈을 설정합니다. macOS 관리자 승인 창에서 직접 인증하세요.');
  const script = 'on run argv\n do shell script (quoted form of (item 1 of argv) & " " & quoted form of (item 2 of argv) & " " & quoted form of (item 3 of argv)) with administrator privileges\nend run';
  const result = await command('/usr/bin/osascript', ['-e', script, binary, action, String(process.getuid())], 240000);
  if (result.code !== 0) throw new PresenceError('POWER_SETUP', 'macOS 전원 모듈 설정이 완료되지 않았습니다. 시스템 승인을 확인한 뒤 다시 실행하세요.');
  if (action === 'install') {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await powerRequest('status'); return; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    throw new PresenceError('POWER_UNAVAILABLE', '전원 모듈을 설치했지만 응답하지 않습니다. lid-status를 확인하세요.');
  }
}

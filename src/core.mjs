export const DEFAULT_APP_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
export const DEFAULT_TENANT = 'organizations';
export const LABEL = 'com.lazyest.presence';
export const SESSION_MS = 5 * 60 * 1000;
export const SCHEDULE = '매일 08:00–21:00 (Mac 현지 시간)';

export class PresenceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function safeError(error) {
  if (error instanceof PresenceError) return {code: error.code, message: error.message};
  return {code: 'UNEXPECTED', message: '작업 실패. doctor로 설치 상태를 확인하세요. 인증 원문은 기록하지 않았습니다.'};
}

export function classifyCliError(text, timedOut = false) {
  if (timedOut) return new PresenceError('TIMEOUT', '응답 시간이 초과됐습니다. 네트워크를 확인한 뒤 다시 실행하세요.');
  const aad = text.match(/AADSTS\d+/)?.[0];
  if (aad) return new PresenceError(aad, `Microsoft 로그인 실패 (${aad}). 같은 로그인 방식으로 다시 시도하고, 계속되면 이 오류 코드로 조직 정책을 확인하세요.`);
  if (/403|forbidden|accessdenied|authorization_requestdenied|insufficient|access denied/i.test(text)) {
    return new PresenceError('PERMISSION_DENIED', '로그인 또는 API 접근은 했지만 이 요청이 거부됐습니다. 같은 앱으로 다시 로그인해 동의를 확인하세요. 새 앱 등록이나 관리자 승인을 자동 요청하지 않습니다.');
  }
  if (/401|unauthorized|not logged|sign in|signed in|login first|interaction_required|invalid_grant/i.test(text)) {
    return new PresenceError('LOGIN_REQUIRED', './bootstrap.sh login 으로 본인 회사 계정에 다시 로그인하세요.');
  }
  if (/404|notfound|not found/i.test(text)) return new PresenceError('NOT_FOUND', '요청한 세션이나 리소스가 없습니다.');
  if (/ENOTFOUND|ECONN|ETIMEDOUT|certificate|TLS|network|fetch failed/i.test(text)) {
    return new PresenceError('NETWORK', '네트워크·프록시·인증서 연결을 확인하세요. 인증서 검증을 끄지는 않습니다.');
  }
  return new PresenceError('CLI_FAILED', 'Microsoft 365 요청이 실패했습니다. doctor와 본인 로그인 상태를 확인하세요.');
}

export function withinSchedule(now) {
  return now.getHours() >= 8 && now.getHours() < 21;
}

export function sessionFresh(lastWriteAt, now) {
  const age = now.getTime() - Date.parse(lastWriteAt);
  return Number.isFinite(age) && age >= 0 && age < SESSION_MS;
}

export function sameIdentity(config, current) {
  return current && ['browser', 'deviceCode'].includes(current.authType)
    && current.cloudType === 'Public'
    && current.connectionName === config.connectionName
    && current.appId === config.appId
    && current.connectedAs?.toLowerCase() === config.connectedAs.toLowerCase();
}

// Reuse the user's working CLI connection; only open login when it is missing or requested.
export async function installIdentity({opts = {}, api, login}) {
  let identity;
  try { identity = await api.identity(); }
  catch (error) { if (error.code !== 'LOGIN_REQUIRED') throw error; }
  if (!identity?.connectedAs || (opts['app-id'] && identity.appId !== opts['app-id'])
      || (opts.tenant && identity.appTenant !== opts.tenant)) identity = await login(opts);
  if (opts.account && identity.connectedAs.toLowerCase() !== opts.account.toLowerCase()) {
    throw new PresenceError('ACCOUNT_CHANGED', '현재 CLI 계정이 --account와 다릅니다. login --account로 본인 계정을 선택하세요.');
  }
  if (!['browser', 'deviceCode'].includes(identity.authType) || identity.cloudType !== 'Public') {
    throw new PresenceError('LOGIN_TYPE', '회사 계정의 browser/deviceCode 로그인을 사용합니다. login 명령으로 전환하세요.');
  }
  if (!identity.appId || !identity.connectionName) throw new PresenceError('LOGIN_REQUIRED', 'CLI 연결 정보가 불완전합니다. login으로 다시 로그인하세요.');
  const profile = await api.profile();
  if (!profile?.id || !profile.userPrincipalName) throw new PresenceError('PROFILE', '본인 Microsoft 프로필을 확인하지 못했습니다.');
  const config = {schemaVersion: 1, userId: profile.id, connectedAs: identity.connectedAs,
    connectionName: identity.connectionName, appId: identity.appId};
  if (!sameIdentity(config, await api.identity())) throw new PresenceError('ACCOUNT_CHANGED', '설치 중 계정이 바뀌어 중단했습니다.');
  return config;
}

export function calendarEntries() {
  const entries = [];
  for (let hour = 8; hour < 21; hour++) {
    for (let minute = 0; minute < 60; minute += 2) entries.push({Hour: hour, Minute: minute});
  }
  entries.push({Hour: 21, Minute: 0});
  return entries;
}

export function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function launchPlist(node, script, base) {
  const entries = calendarEntries().map(entry => '<dict>' + Object.entries(entry)
    .map(([key, value]) => `<key>${key}</key><integer>${value}</integer>`).join('') + '</dict>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>tick</string></array>
<key>EnvironmentVariables</key><dict><key>LAZYEST_PRESENCE_HOME</key><string>${xml(base)}</string></dict>
<key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
<key>StartCalendarInterval</key><array>${entries}</array>
</dict></plist>\n`;
}

/** Injected API/clock enables failure tests without changing a real Teams account. */
export async function cycle({config, previous = {}, now = () => new Date(), api, power = async () => ({})}) {
  const state = {checkedAt: now().toISOString(), schedule: SCHEDULE,
    lastWriteAt: previous.lastWriteAt ?? null, history: (previous.history ?? []).slice(-15)};
  try {
    const active = withinSchedule(now());
    state.action = active ? 'renew' : 'idle';
    if (active) {
      Object.assign(state, await power());
      if (state.onACPower === false && Number.isFinite(state.batteryPercent) && state.batteryPercent <= 20) {
        state.action = 'battery_pause';
      }
    }
    if (state.action !== 'renew' && !sessionFresh(state.lastWriteAt, now())) {
      state.ok = true;
    } else {
      if (!sameIdentity(config, await api.identity())) throw new PresenceError('ACCOUNT_CHANGED',
        'Microsoft 365 계정이나 앱이 설치 당시와 달라 상태를 변경하지 않았습니다. 원래 연결을 선택하거나 설치 계정을 확인하세요.');
      if (state.action === 'renew' && !withinSchedule(now())) state.action = 'idle';
      if (state.action === 'renew') {
        await api.set(config, {sessionId: config.appId, availability: 'Available', activity: 'Available', expirationDuration: 'PT5M'});
        // Record the successful write even if the subsequent read fails.
        state.lastWriteAt = now().toISOString();
      } else if (sessionFresh(state.lastWriteAt, now())) {
        try { await api.clear(config, {sessionId: config.appId}); }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        state.lastWriteAt = null;
        if (state.action !== 'battery_pause') state.action = 'clear';
      }
      const presence = await api.get(config);
      state.availability = presence.availability;
      state.activity = presence.activity;
      state.ok = true;
    }
  } catch (error) { state.ok = false; state.error = safeError(error); }
  state.history.push(Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'history')));
  return state;
}

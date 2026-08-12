import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

/**
 * Supabase 통신 계층.
 *
 * 공식 supabase-js 를 쓰지 않고 직접 만든 이유는 두 가지다. 하나는 이 저장소가
 * 빌드 단계도 npm 의존성도 두지 않기로 했다는 것이고, 다른 하나는 CDN 에서
 * 스크립트를 받아 오면 제3자가 개인정보를 다루는 페이지에 임의의 코드를
 * 실행시킬 수 있게 된다는 것이다. 우리가 쓰는 범위는 인증과 REST 조회뿐이라
 * 직접 만드는 편이 검증하기도 쉽다.
 *
 * 대신 직접 책임져야 하는 것이 토큰 갱신이다. 액세스 토큰은 한 시간이면
 * 만료되므로 아래 refresh 경로가 이 파일에서 가장 중요한 부분이다.
 */

export const SESSION_KEY = 'igm_lms_session';

/** 만료 몇 초 전부터 미리 갱신할지. 요청 도중에 만료되는 것을 막는다. */
const REFRESH_MARGIN_SEC = 60;

let baseUrl = SUPABASE_URL;
let apiKey = SUPABASE_KEY;
let retryDelays = [400, 1200];

/** 테스트와 로컬 확인용. */
export function setEndpoint(url, key) {
  baseUrl = url;
  apiKey = key;
}

/** 재시도 간격을 바꾼다. 테스트가 기다리지 않게 하려고 둔다. */
export function setRetryDelays(delays) {
  retryDelays = delays;
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// 세션 보관
// ---------------------------------------------------------------------------

export function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // 갱신에 필요한 것이 하나라도 없으면 없는 것과 같다. 깨진 값을 들고
    // 로그인 상태라고 착각하면 화면이 빈 채로 멈춘다.
    if (!parsed || !parsed.access_token || !parsed.refresh_token) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** 인증 응답을 우리가 보관하는 모양으로 바꾼다. */
export function toSession(body) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at || (nowSec() + (body.expires_in || 3600)),
    user_id: body.user ? body.user.id : null,
  };
}

// ---------------------------------------------------------------------------
// 오류 변환
// ---------------------------------------------------------------------------

const AUTH_MESSAGES = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
  email_not_confirmed: '이메일 확인이 완료되지 않은 계정입니다.',
  user_already_exists: '이미 가입된 이메일입니다.',
  email_exists: '이미 가입된 이메일입니다.',
  email_address_invalid: '이메일 형식이 올바르지 않습니다.',
  weak_password: '비밀번호가 정책에 맞지 않습니다.',
  over_request_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  over_email_send_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  signup_disabled: '현재 회원가입이 중지되어 있습니다.',
};

/** PostgREST 는 오류를 SQLSTATE 로 돌려준다. 사용자에게 보일 말로 바꾼다. */
const REST_MESSAGES = {
  42501: '권한이 없습니다.',
  23505: '이미 존재하는 값입니다.',
  23514: '입력값이 허용된 범위를 벗어났습니다.',
  23503: '다른 자료가 참조하고 있어 처리할 수 없습니다.',
  23502: '필수 항목이 비어 있습니다.',
  22007: '날짜 형식이 올바르지 않습니다.',
};

function authError(status, body) {
  const code = (body && (body.error_code || body.error)) || 'AUTH_ERROR';
  const known = AUTH_MESSAGES[code];
  if (known) return new ApiError(code, known);
  const message = (body && (body.msg || body.error_description || body.message)) || '';
  return new ApiError(code, message || '인증 처리 중 오류가 발생했습니다. (' + status + ')');
}

function restError(status, body) {
  const code = (body && body.code) || String(status);
  const known = REST_MESSAGES[code];
  if (known) return new ApiError(code, known);

  // 서버 함수(raise exception)의 메시지는 우리가 한국어로 쓴 것이므로 그대로 보인다.
  if (code === 'P0001' && body && body.message) {
    return new ApiError(code, body.message);
  }
  const message = (body && body.message) || '';
  return new ApiError(code, message || '요청을 처리하지 못했습니다. (' + status + ')');
}

// ---------------------------------------------------------------------------
// 기본 요청
// ---------------------------------------------------------------------------

/**
 * 네트워크 오류만 재시도한다. 서버가 응답을 준 이상 그 응답이 결론이다.
 * 4xx 를 재시도하면 잠금 카운터만 올린다.
 */
async function send(path, options) {
  const opts = options || {};
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  if (opts.prefer) headers.Prefer = opts.prefer;

  const init = { method: opts.method || 'GET', headers: headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]);

    let response;
    try {
      response = await fetch(baseUrl + path, init);
    } catch (networkError) {
      continue;
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        throw new ApiError('BAD_RESPONSE', '서버 응답을 이해할 수 없습니다.');
      }
    }
    return { status: response.status, body: parsed };
  }

  throw new ApiError('NETWORK', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
}

/** 인증 엔드포인트. 세션이 없어도 부를 수 있다. */
export async function authCall(path, body, token) {
  const result = await send('/auth/v1' + path, { method: 'POST', body: body, token: token });
  if (result.status >= 400) throw authError(result.status, result.body);
  return result.body;
}

// ---------------------------------------------------------------------------
// 토큰 갱신
// ---------------------------------------------------------------------------

// 화면이 여러 요청을 동시에 보내면 갱신도 여러 번 돈다. 먼저 성공한 갱신이
// 리프레시 토큰을 소모해 버리므로 나머지는 실패하고 사용자가 튕긴다.
// 진행 중인 갱신이 있으면 그 결과를 함께 기다린다.
let refreshing = null;

async function doRefresh(session) {
  const result = await send('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: session.refresh_token },
  });
  if (result.status >= 400 || !result.body || !result.body.access_token) {
    clearSession();
    throw new ApiError('SESSION_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }
  const next = toSession(result.body);
  // 갱신 응답에는 user 가 없을 수 있다. 알고 있던 값을 잃지 않게 한다.
  if (!next.user_id) next.user_id = session.user_id;
  saveSession(next);
  return next;
}

export async function refreshSession(session) {
  if (refreshing) return refreshing;
  refreshing = doRefresh(session);
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

/** 유효한 세션을 돌려준다. 만료가 가까우면 미리 갱신한다. */
export async function requireSession() {
  const session = getSession();
  if (!session) {
    throw new ApiError('NO_SESSION', '로그인이 필요합니다.');
  }
  if (session.expires_at && session.expires_at - nowSec() <= REFRESH_MARGIN_SEC) {
    return refreshSession(session);
  }
  return session;
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

/**
 * 로그인 상태로 PostgREST 를 호출한다.
 * 만료 직전 갱신을 지나쳤더라도 401 이 오면 한 번 더 갱신하고 재시도한다.
 * 기기 시계가 틀어져 있으면 만료 판단이 어긋나므로 이 경로가 필요하다.
 */
export async function rest(path, options) {
  const opts = options || {};
  let session = await requireSession();

  let result = await send('/rest/v1' + path, {
    method: opts.method, body: opts.body, prefer: opts.prefer, token: session.access_token,
  });

  if (result.status === 401) {
    session = await refreshSession(session);
    result = await send('/rest/v1' + path, {
      method: opts.method, body: opts.body, prefer: opts.prefer, token: session.access_token,
    });
  }

  if (result.status >= 400) throw restError(result.status, result.body);
  return result.body;
}

/** 서버 함수 호출. */
export function rpc(name, args) {
  return rest('/rpc/' + name, { method: 'POST', body: args || {} });
}

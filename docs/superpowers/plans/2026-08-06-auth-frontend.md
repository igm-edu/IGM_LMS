# 인증 프론트엔드와 배포 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `https://igm-edu.github.io/IGM_LMS/`에 접속해 회원가입하고 로그인하면 본인 이름과 소속이 화면에 표시되고, 새로고침해도 로그인이 유지되며, 로그아웃하면 다시 로그인 화면으로 돌아온다.

**Architecture:** 빌드 도구 없는 ES 모듈 세 개(`config.js`·`api.js`·`auth.js`)와 화면 한 장. `api.js`가 통신·재시도·응답 해석을 전담하고, `auth.js`가 토큰 보관과 인증 요청을 감싼다. 화면은 이 둘만 호출한다.

**Tech Stack:** 순수 ES 모듈, 빌드 없음, 의존성 없음. 테스트는 Node 내장 러너에서 `fetch`와 `localStorage`를 대역으로 바꿔 실행한다.

설계 문서: `docs/superpowers/specs/2026-08-05-auth-design.md` 12장·14장

## Global Constraints

- 빌드 단계를 두지 않는다. 브라우저가 파일을 그대로 받아 실행한다. 따라서 `assets/js/`의 파일은 ES 모듈(`import`/`export`)이며, `apps-script/`의 규칙(`var`, 모듈 금지)과는 정반대다. **두 디렉터리의 규칙을 섞지 않는다.**
- 외부 스크립트·폰트·CDN을 페이지에 넣지 않는다. 토큰이 `localStorage`에 있는 이상 외부 스크립트는 토큰 탈취 경로가 된다.
- **사용자가 입력한 값이나 서버에서 받은 값은 `textContent`로만 넣는다.** `innerHTML`에 문자열을 조립해 넣지 않는다.
- 요청은 `Content-Type: text/plain;charset=utf-8`로 보낸다. Apps Script 웹앱은 CORS 사전 요청에 응답할 수 없어, 이를 어기면 통신 자체가 실패한다. 같은 이유로 **토큰은 헤더가 아니라 본문에 담는다.**
- 응답의 성공 여부는 HTTP 상태가 아니라 본문의 `ok`로 판단한다. Apps Script는 항상 200을 반환한다.
- 네트워크 오류만 재시도한다. 서버가 `ok: false`로 답한 것은 정상 응답이므로 재시도하지 않는다.
- 외부 npm 의존성을 추가하지 않는다.
- 화면은 담백하게 만든다. 흰 배경, 가운데 정렬된 폼 하나, 강조색 한 가지. 로고나 브랜드 색은 넣지 않는다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `assets/js/config.js` | 웹앱 엔드포인트 주소 하나 |
| `assets/js/api.js` | 요청 조립, 재시도, 응답 해석, `ApiError` |
| `assets/js/auth.js` | 토큰 보관, 로그인·가입·로그아웃, 만료 시 토큰 정리 |
| `assets/js/main.js` | 화면 배선 — 폼 제출, 화면 전환, 오류 표시 |
| `assets/css/style.css` | 화면 스타일 |
| `index.html` | 로그인 · 회원가입 · 로그인 후 화면의 뼈대 |
| `test/helpers/browser-shim.js` | Node에서 `fetch`와 `localStorage`를 대신하는 대역 |
| `test/api-client.test.js` | `api.js` 테스트 |
| `test/auth-client.test.js` | `auth.js` 테스트 |

프론트 모듈은 ES 모듈이고 테스트 파일은 CommonJS다. 테스트에서는 동적 `import()`로 불러온다. Node 24는 CommonJS에서 ES 모듈을 이렇게 불러오는 것을 지원한다.

---

### Task 1: 브라우저 대역과 통신 모듈

`api.js`를 만든다. 이후 모든 화면이 서버와 대화하는 유일한 통로다.

**Files:**
- Create: `assets/js/config.js`
- Create: `assets/js/api.js`
- Create: `test/helpers/browser-shim.js`
- Test: `test/api-client.test.js`

**Interfaces:**
- Produces (`config.js`): `API_URL` — 배포 주소. 초기값은 자리표시자 `__WEB_APP_URL__`이며 Task 4에서 실제 주소로 바꾼다.
- Produces (`api.js`):
  - `call(action, payload, token) -> Promise<data>` — 성공하면 응답의 `data`를 그대로 돌려준다.
  - `ApiError` — `code`와 `message`를 갖는 Error 하위 클래스.
  - `setApiUrl(url)`, `setRetryDelays(delays)` — 테스트와 로컬 확인용.
  - `UNSET_API_URL` — 자리표시자 상수.
- Produces (`browser-shim.js`): `installFetch(handler)`, `restoreFetch()`, `installLocalStorage()`, `resetLocalStorage()`, `lastRequest()`

- [ ] **Step 1: 브라우저 대역 작성**

`test/helpers/browser-shim.js`:

```js
'use strict';

let originalFetch;
let recorded = [];

/** handler(url, options) -> { status?, text } 또는 Error를 던져 네트워크 오류를 흉내낸다. */
function installFetch(handler) {
  originalFetch = global.fetch;
  recorded = [];
  global.fetch = async function (url, options) {
    recorded.push({ url, options });
    const result = await handler(url, options, recorded.length);
    return {
      status: result.status === undefined ? 200 : result.status,
      text: async () => result.text,
    };
  };
}

function restoreFetch() {
  global.fetch = originalFetch;
}

function requests() {
  return recorded;
}

function lastRequest() {
  return recorded[recorded.length - 1];
}

const store = new Map();

function installLocalStorage() {
  global.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

function resetLocalStorage() {
  store.clear();
}

module.exports = {
  installFetch,
  restoreFetch,
  requests,
  lastRequest,
  installLocalStorage,
  resetLocalStorage,
};
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/api-client.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const API = 'https://example.test/exec';

async function loadApi() {
  const api = await import('../assets/js/api.js');
  api.setApiUrl(API);
  api.setRetryDelays([1, 1]);
  return api;
}

test('요청은 text/plain으로 보내고 본문에 action과 payload를 담는다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({ text: JSON.stringify({ ok: true, data: { hi: 1 } }) }));

  try {
    const data = await api.call('auth.me', { a: 1 }, 'TOKEN123');
    assert.deepStrictEqual(data, { hi: 1 });

    const sent = shim.lastRequest();
    assert.strictEqual(sent.url, API);
    assert.strictEqual(sent.options.method, 'POST');
    assert.strictEqual(sent.options.headers['Content-Type'], 'text/plain;charset=utf-8');

    const body = JSON.parse(sent.options.body);
    assert.strictEqual(body.action, 'auth.me');
    assert.deepStrictEqual(body.payload, { a: 1 });
    assert.strictEqual(body.token, 'TOKEN123');
  } finally {
    shim.restoreFetch();
  }
});

test('사용자 정의 헤더를 보내지 않는다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({ text: JSON.stringify({ ok: true, data: null }) }));

  try {
    await api.call('auth.me', {}, 'T');
    const headers = shim.lastRequest().options.headers;
    // 사전 요청을 유발하는 헤더가 하나라도 있으면 Apps Script와 통신이 깨진다.
    assert.deepStrictEqual(Object.keys(headers), ['Content-Type']);
  } finally {
    shim.restoreFetch();
  }
});

test('토큰이 없으면 빈 문자열로 보낸다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({ text: JSON.stringify({ ok: true, data: null }) }));

  try {
    await api.call('auth.login', { email: 'a@b.com' });
    assert.strictEqual(JSON.parse(shim.lastRequest().options.body).token, '');
  } finally {
    shim.restoreFetch();
  }
});

test('ok가 false면 코드와 메시지를 담은 ApiError를 던진다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({
    text: JSON.stringify({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: '틀렸습니다.' } }),
  }));

  try {
    await assert.rejects(() => api.call('auth.login', {}), (err) => {
      assert.ok(err instanceof api.ApiError);
      assert.strictEqual(err.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(err.message, '틀렸습니다.');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('서버가 답한 오류는 재시도하지 않는다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({
    text: JSON.stringify({ ok: false, error: { code: 'BAD_REQUEST', message: '잘못됨' } }),
  }));

  try {
    await assert.rejects(() => api.call('auth.login', {}));
    assert.strictEqual(shim.requests().length, 1, '정상 응답이므로 한 번만 보내야 한다');
  } finally {
    shim.restoreFetch();
  }
});

test('네트워크 오류는 두 번까지 재시도한다', async () => {
  const api = await loadApi();
  let calls = 0;
  shim.installFetch(async () => {
    calls += 1;
    if (calls < 3) throw new Error('network down');
    return { text: JSON.stringify({ ok: true, data: { recovered: true } }) };
  });

  try {
    assert.deepStrictEqual(await api.call('auth.me', {}, 'T'), { recovered: true });
    assert.strictEqual(calls, 3, '첫 시도 + 재시도 2회');
  } finally {
    shim.restoreFetch();
  }
});

test('재시도를 모두 소진하면 NETWORK 오류를 던진다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => { throw new Error('network down'); });

  try {
    await assert.rejects(() => api.call('auth.me', {}, 'T'), (err) => {
      assert.strictEqual(err.code, 'NETWORK');
      return true;
    });
    assert.strictEqual(shim.requests().length, 3);
  } finally {
    shim.restoreFetch();
  }
});

test('JSON이 아닌 응답은 BAD_RESPONSE로 알린다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({ text: '<html>구글 로그인 페이지</html>' }));

  try {
    await assert.rejects(() => api.call('auth.me', {}, 'T'), (err) => {
      assert.strictEqual(err.code, 'BAD_RESPONSE');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('배포 주소를 채우지 않았으면 그렇다고 알려준다', async () => {
  const api = await import('../assets/js/api.js');
  api.setApiUrl(api.UNSET_API_URL);
  shim.installFetch(async () => ({ text: '{}' }));

  try {
    await assert.rejects(() => api.call('auth.me', {}), (err) => {
      assert.strictEqual(err.code, 'CONFIG');
      assert.match(err.message, /config\.js/);
      return true;
    });
    assert.strictEqual(shim.requests().length, 0, '요청을 보내지도 말아야 한다');
  } finally {
    shim.restoreFetch();
    api.setApiUrl(API);
  }
});
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module` 또는 `assets/js/api.js`를 찾을 수 없다는 오류

- [ ] **Step 4: `assets/js/config.js` 작성**

```js
// 웹앱 엔드포인트. 이 주소는 비밀이 아니다 — 유효한 토큰 없이는
// 어떤 데이터도 반환하지 않는다.
// Task 4에서 정식 배포 주소로 바꾼다.
export const API_URL = '__WEB_APP_URL__';
```

- [ ] **Step 5: `assets/js/api.js` 작성**

```js
import { API_URL } from './config.js';

/** config.js를 아직 채우지 않았을 때의 값. */
export const UNSET_API_URL = '__WEB_APP_URL__';

let apiUrl = API_URL;
let retryDelays = [400, 1200];

/** 배포 주소를 바꾼다. 테스트와 로컬 확인용. */
export function setApiUrl(url) {
  apiUrl = url;
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

/**
 * 서버에 요청을 보내고 응답의 data를 돌려준다.
 *
 * Apps Script 웹앱은 CORS 사전 요청에 응답할 수 없다. 그래서 Content-Type을
 * text/plain으로 두어 사전 요청이 아예 생기지 않게 하고, 토큰도 헤더가 아니라
 * 본문에 담는다. 헤더를 하나라도 더 붙이면 통신이 통째로 실패한다.
 */
export async function call(action, payload, token) {
  if (apiUrl === UNSET_API_URL) {
    throw new ApiError('CONFIG', '웹앱 주소가 설정되지 않았습니다. assets/js/config.js를 확인하세요.');
  }

  const body = JSON.stringify({
    action: action,
    token: token || '',
    payload: payload || {},
  });

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]);

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
      });
    } catch (networkError) {
      continue; // 네트워크 오류만 재시도한다
    }

    let parsed;
    try {
      parsed = JSON.parse(await response.text());
    } catch (parseError) {
      // 서버가 JSON이 아닌 것을 돌려준 경우다. 대개 배포 설정이 잘못돼
      // 구글 로그인 페이지가 오는 상황이라 재시도해도 소용없다.
      throw new ApiError('BAD_RESPONSE', '서버 응답을 이해할 수 없습니다. 배포 설정을 확인해 주세요.');
    }

    if (parsed && parsed.ok) return parsed.data;

    const error = (parsed && parsed.error) || {};
    throw new ApiError(error.code || 'INTERNAL', error.message || '오류가 발생했습니다.');
  }

  throw new ApiError('NETWORK', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
}
```

- [ ] **Step 6: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 141 tests pass (기존 132 + 신규 9)

- [ ] **Step 7: 커밋**

```bash
git add assets/js/config.js assets/js/api.js test/helpers/browser-shim.js test/api-client.test.js
git commit -m "feat: 프론트 통신 모듈과 브라우저 대역"
```

---

### Task 2: 토큰 보관과 인증 요청

`auth.js`를 만든다. 화면이 토큰을 직접 다루지 않게 하는 것이 목적이다.

**Files:**
- Create: `assets/js/auth.js`
- Test: `test/auth-client.test.js`

**Interfaces:**
- Consumes: `call`, `ApiError` (api.js)
- Produces:
  - `getToken() -> string | null`, `saveToken(token)`, `clearToken()`
  - `isLoggedIn() -> boolean`
  - `signup(payload) -> Promise<user>` — 성공하면 토큰을 저장한다
  - `login(email, password) -> Promise<user>` — 성공하면 토큰을 저장한다
  - `logout() -> Promise<void>` — 서버 호출이 실패해도 토큰은 지운다
  - `me() -> Promise<user>`
  - `updateProfile(patch) -> Promise<user>`
  - 상수 `TOKEN_KEY`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/auth-client.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

shim.installLocalStorage();

const API = 'https://example.test/exec';

async function loadAuth() {
  const api = await import('../assets/js/api.js');
  api.setApiUrl(API);
  api.setRetryDelays([1, 1]);
  const auth = await import('../assets/js/auth.js');
  shim.resetLocalStorage();
  return { api, auth };
}

function okResponse(data) {
  return async () => ({ text: JSON.stringify({ ok: true, data: data }) });
}

function errorResponse(code, message) {
  return async () => ({ text: JSON.stringify({ ok: false, error: { code, message } }) });
}

test('로그인에 성공하면 토큰을 저장하고 사용자를 돌려준다', async () => {
  const { auth } = await loadAuth();
  shim.installFetch(okResponse({ token: 'T1', user: { name: '홍길동' } }));

  try {
    const user = await auth.login('hong@igm.co.kr', 'abcd1234');
    assert.strictEqual(user.name, '홍길동');
    assert.strictEqual(auth.getToken(), 'T1');
    assert.strictEqual(auth.isLoggedIn(), true);
  } finally {
    shim.restoreFetch();
  }
});

test('로그인에 실패하면 토큰을 저장하지 않는다', async () => {
  const { auth } = await loadAuth();
  shim.installFetch(errorResponse('INVALID_CREDENTIALS', '틀렸습니다.'));

  try {
    await assert.rejects(() => auth.login('hong@igm.co.kr', 'wrong'));
    assert.strictEqual(auth.getToken(), null);
    assert.strictEqual(auth.isLoggedIn(), false);
  } finally {
    shim.restoreFetch();
  }
});

test('가입에 성공하면 바로 로그인 상태가 된다', async () => {
  const { auth } = await loadAuth();
  shim.installFetch(okResponse({ token: 'T2', user: { name: '김철수' } }));

  try {
    const user = await auth.signup({ name: '김철수', email: 'kim@igm.co.kr' });
    assert.strictEqual(user.name, '김철수');
    assert.strictEqual(auth.getToken(), 'T2');
  } finally {
    shim.restoreFetch();
  }
});

test('인증 요청은 저장된 토큰을 함께 보낸다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('SAVED');
  shim.installFetch(okResponse({ name: '홍길동' }));

  try {
    await auth.me();
    assert.strictEqual(JSON.parse(shim.lastRequest().options.body).token, 'SAVED');
  } finally {
    shim.restoreFetch();
  }
});

test('토큰이 만료되면 저장된 토큰을 지운다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('EXPIRED');
  shim.installFetch(errorResponse('TOKEN_EXPIRED', '만료되었습니다.'));

  try {
    await assert.rejects(() => auth.me(), (err) => {
      assert.strictEqual(err.code, 'TOKEN_EXPIRED');
      return true;
    });
    assert.strictEqual(auth.getToken(), null, '만료된 토큰은 남겨두면 안 된다');
  } finally {
    shim.restoreFetch();
  }
});

test('토큰이 무효여도 저장된 토큰을 지운다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('BOGUS');
  shim.installFetch(errorResponse('TOKEN_INVALID', '로그인이 필요합니다.'));

  try {
    await assert.rejects(() => auth.me());
    assert.strictEqual(auth.getToken(), null);
  } finally {
    shim.restoreFetch();
  }
});

test('다른 오류에서는 토큰을 지우지 않는다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('KEEP');
  shim.installFetch(errorResponse('BAD_REQUEST', '입력을 확인하세요.'));

  try {
    await assert.rejects(() => auth.updateProfile({ name: '' }));
    assert.strictEqual(auth.getToken(), 'KEEP', '입력 오류로 로그아웃시키면 안 된다');
  } finally {
    shim.restoreFetch();
  }
});

test('로그아웃은 서버 호출이 실패해도 토큰을 지운다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('T3');
  shim.installFetch(async () => { throw new Error('network down'); });

  try {
    await auth.logout();
    assert.strictEqual(auth.getToken(), null, '연결이 끊겨도 로컬은 로그아웃되어야 한다');
  } finally {
    shim.restoreFetch();
  }
});

test('로그아웃은 서버에도 알린다', async () => {
  const { auth } = await loadAuth();
  auth.saveToken('T4');
  shim.installFetch(okResponse({ ok: true }));

  try {
    await auth.logout();
    assert.strictEqual(JSON.parse(shim.lastRequest().options.body).action, 'auth.logout');
    assert.strictEqual(auth.getToken(), null);
  } finally {
    shim.restoreFetch();
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `assets/js/auth.js`를 찾을 수 없음

- [ ] **Step 3: `assets/js/auth.js` 작성**

```js
import { call, ApiError } from './api.js';

export const TOKEN_KEY = 'igm_lms_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

/**
 * 토큰이 필요한 요청. 토큰이 만료되거나 무효라고 서버가 답하면
 * 저장된 토큰을 지운다. 남겨두면 화면이 로그인 상태라고 착각한다.
 */
async function callAuthed(action, payload) {
  try {
    return await call(action, payload, getToken());
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'TOKEN_EXPIRED' || err.code === 'TOKEN_INVALID')) {
      clearToken();
    }
    throw err;
  }
}

export async function signup(payload) {
  const data = await call('auth.signup', payload);
  saveToken(data.token);
  return data.user;
}

export async function login(email, password) {
  const data = await call('auth.login', { email: email, password: password });
  saveToken(data.token);
  return data.user;
}

/** 서버 호출이 실패해도 로컬 토큰은 반드시 지운다. */
export async function logout() {
  try {
    await callAuthed('auth.logout', {});
  } catch (err) {
    // 연결이 끊겼거나 토큰이 이미 죽었어도 로컬은 로그아웃 상태여야 한다.
  } finally {
    clearToken();
  }
}

export async function me() {
  return callAuthed('auth.me', {});
}

export async function updateProfile(patch) {
  return callAuthed('auth.updateProfile', patch);
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 150 tests pass (141 + 신규 9)

- [ ] **Step 5: 커밋**

```bash
git add assets/js/auth.js test/auth-client.test.js
git commit -m "feat: 토큰 보관과 인증 요청 모듈"
```

---

### Task 3: 로그인·회원가입 화면

**Files:**
- Create: `index.html`
- Create: `assets/css/style.css`

**Interfaces:**
- Consumes: `assets/js/auth.js`의 `signup`, `login`, `logout`, `me`, `isLoggedIn`

이 태스크에는 자동 테스트가 없다. 화면 동작은 Task 4에서 브라우저로 확인한다. 대신 아래 규칙을 코드에서 지킨다.

- [ ] **Step 1: `index.html` 작성**

세 영역을 두고 하나만 보이게 한다. 로그인 폼, 회원가입 폼, 로그인 후 화면이다.

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IGM 이러닝</title>
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
  <main class="card">
    <h1 class="brand">IGM 이러닝</h1>

    <section id="view-login">
      <h2>로그인</h2>
      <form id="form-login" novalidate>
        <label>이메일<input type="email" name="email" autocomplete="email" required></label>
        <label>비밀번호<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="message" id="message-login" role="alert"></p>
        <button type="submit">로그인</button>
      </form>
      <p class="switch">처음이신가요? <button type="button" class="link" id="go-signup">회원가입</button></p>
    </section>

    <section id="view-signup" hidden>
      <h2>회원가입</h2>
      <form id="form-signup" novalidate>
        <label>이름<input name="name" autocomplete="name" required></label>
        <label>이메일<input type="email" name="email" autocomplete="email" required></label>
        <label>비밀번호<input type="password" name="password" autocomplete="new-password" required>
          <span class="hint">8자 이상, 영문과 숫자를 모두 포함</span></label>
        <label>연락처<input name="phone" autocomplete="tel" required></label>
        <label>소속<input name="company" autocomplete="organization" required></label>
        <label>직급<input name="position" autocomplete="organization-title" required></label>
        <label>생년월일<input type="date" name="birth_date" required></label>
        <label class="consent">
          <input type="checkbox" name="consent" required>
          <span>개인정보 수집·이용에 동의합니다. 이름·이메일·연락처·소속·직급·생년월일을
          수강 관리와 수료증 발급에 사용하며, 수료 후 3년간 보관합니다.</span>
        </label>
        <p class="message" id="message-signup" role="alert"></p>
        <button type="submit">가입하고 시작하기</button>
      </form>
      <p class="switch">이미 계정이 있으신가요? <button type="button" class="link" id="go-login">로그인</button></p>
    </section>

    <section id="view-home" hidden>
      <h2>환영합니다</h2>
      <p><strong id="home-name"></strong><span id="home-company"></span></p>
      <p class="note">수강 중인 과정은 곧 이곳에 표시됩니다.</p>
      <button type="button" id="do-logout">로그아웃</button>
    </section>
  </main>

  <script type="module" src="assets/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: `assets/js/main.js` 작성**

화면 배선을 별도 파일로 둔다. `index.html`에 스크립트를 인라인으로 넣으면 나중에 화면이 늘어날 때 중복이 생긴다.

```js
import { signup, login, logout, me, isLoggedIn } from './auth.js';

const views = {
  login: document.getElementById('view-login'),
  signup: document.getElementById('view-signup'),
  home: document.getElementById('view-home'),
};

function show(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
}

/** 사용자 입력과 서버 응답은 textContent로만 넣는다. */
function setMessage(id, text) {
  document.getElementById(id).textContent = text || '';
}

function showHome(user) {
  document.getElementById('home-name').textContent = user.name;
  document.getElementById('home-company').textContent = user.company ? ' · ' + user.company : '';
  show('home');
}

function formValues(form) {
  const data = {};
  new FormData(form).forEach(function (value, key) { data[key] = value; });
  return data;
}

function busy(form, on) {
  form.querySelector('button[type="submit"]').disabled = on;
}

document.getElementById('go-signup').addEventListener('click', function () {
  setMessage('message-signup', '');
  show('signup');
});

document.getElementById('go-login').addEventListener('click', function () {
  setMessage('message-login', '');
  show('login');
});

document.getElementById('form-login').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-login', '');
  busy(form, true);
  try {
    const values = formValues(form);
    showHome(await login(values.email, values.password));
    form.reset();
  } catch (err) {
    setMessage('message-login', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('form-signup').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-signup', '');

  const values = formValues(form);
  values.consent = form.querySelector('input[name="consent"]').checked;
  if (!values.consent) {
    setMessage('message-signup', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
    return;
  }

  busy(form, true);
  try {
    showHome(await signup(values));
    form.reset();
  } catch (err) {
    setMessage('message-signup', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('do-logout').addEventListener('click', async function () {
  await logout();
  show('login');
});

// 새로고침해도 로그인이 유지되게 한다. 토큰이 죽었으면 auth.js가 지우고
// 여기서는 로그인 화면으로 돌아간다.
(async function start() {
  if (!isLoggedIn()) {
    show('login');
    return;
  }
  try {
    showHome(await me());
  } catch (err) {
    show('login');
  }
})();
```

`index.html`의 스크립트 경로를 `assets/js/main.js`로 두었으므로 File Structure 표에 이 파일을 더한다.

- [ ] **Step 3: `assets/css/style.css` 작성**

```css
:root {
  --accent: #1f6feb;
  --text: #1a1a1a;
  --muted: #666;
  --border: #d8d8d8;
  --error: #b3261e;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2rem 1rem;
  background: #fff;
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
  line-height: 1.6;
  display: flex;
  justify-content: center;
}

.card {
  width: 100%;
  max-width: 26rem;
}

.brand {
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 2rem;
}

h2 {
  font-size: 1.5rem;
  margin: 0 0 1.5rem;
}

label {
  display: block;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  color: var(--muted);
}

input[type="email"],
input[type="password"],
input[type="date"],
input:not([type]) {
  display: block;
  width: 100%;
  margin-top: 0.375rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 1rem;
  color: var(--text);
}

input:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-color: var(--accent);
}

.hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.consent {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.consent input { margin-top: 0.25rem; }

button[type="submit"],
#do-logout {
  width: 100%;
  padding: 0.75rem;
  border: 0;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
}

button[type="submit"]:disabled {
  opacity: 0.5;
  cursor: default;
}

#do-logout {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.switch {
  margin-top: 1.5rem;
  font-size: 0.875rem;
  color: var(--muted);
}

.message {
  min-height: 1.25rem;
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--error);
}

.note {
  color: var(--muted);
  font-size: 0.875rem;
}
```

- [ ] **Step 4: 테스트가 여전히 통과하는지 확인**

Run: `npm test`
Expected: 150 tests pass — 이 태스크는 테스트를 추가하지 않으므로 개수가 그대로여야 한다.

- [ ] **Step 5: 커밋**

```bash
git add index.html assets/js/main.js assets/css/style.css
git commit -m "feat: 로그인·회원가입 화면"
```

---

### Task 4: 정식 배포와 브라우저 확인

**Files:**
- Modify: `assets/js/config.js` (실제 배포 주소)
- Modify: `README.md`

현재 Apps Script에는 `@HEAD` 개발용 배포만 있다. 이 주소는 소유자 본인만 접근할 수 있어 수강생이 쓸 수 없다. 버전을 고정한 정식 배포를 만들어야 한다.

- [ ] **Step 1: 최신 코드 업로드**

```bash
cd apps-script && clasp push
```

- [ ] **Step 2: 정식 배포 생성**

```bash
cd apps-script && clasp create-deployment --description "auth v1"
```

설치된 clasp는 3.3.0이다. `--description` 플래그가 없다는 오류가 나면 `clasp create-deployment --help`로 실제 플래그 이름을 확인하고 그것을 쓴다. 설명은 없어도 배포는 만들어진다.

출력에 `AKfycb...` 형태의 배포 ID가 나온다. 웹앱 주소는 `https://script.google.com/macros/s/<배포ID>/exec` 형태다. **끝이 `/exec`여야 한다.** `/dev`로 끝나는 주소는 소유자 전용이다.

- [ ] **Step 3: 익명 접근 확인**

브라우저의 시크릿 창에서 `/exec` 주소를 연다.

Expected: `{"ok":true,"data":{"service":"IGM LMS API","status":"ok"}}`

구글 로그인 화면이 뜨면 배포 설정이 잘못된 것이다. Apps Script 편집기에서 배포 설정의 "액세스 권한이 있는 사용자"가 "모든 사용자"인지 확인한다.

- [ ] **Step 4: `config.js`에 주소 기록**

`assets/js/config.js`의 `API_URL`을 Step 2에서 얻은 `/exec` 주소로 바꾼다.

- [ ] **Step 5: 배포**

```bash
git add assets/js/config.js && git commit -m "chore: 웹앱 배포 주소 기록" && git push
```

GitHub Pages는 `main`에 푸시하면 1~2분 안에 반영된다.

- [ ] **Step 6: 브라우저에서 종단 확인**

`https://igm-edu.github.io/IGM_LMS/`를 열고 순서대로 확인한다.

1. 회원가입 화면에서 실제 정보로 가입한다. 성공하면 이름과 소속이 보이는 화면으로 바뀐다.
2. 새로고침한다. 로그인 화면이 아니라 환영 화면이 그대로 나와야 한다.
3. 로그아웃한다. 로그인 화면으로 돌아간다.
4. 방금 만든 계정으로 로그인한다. 다시 환영 화면이 나온다.
5. 비밀번호를 틀리게 넣어 본다. "이메일 또는 비밀번호가 올바르지 않습니다."가 폼 안에 표시된다.
6. 같은 이메일로 다시 가입해 본다. "이미 가입된 이메일입니다."가 표시된다.
7. 8자 미만이거나 숫자가 없는 비밀번호로 가입해 본다. 해당 사유가 표시된다.
8. 브라우저 개발자 도구의 네트워크 탭에서 응답 본문에 `password_hash`가 없는지 확인한다.
9. 스프레드시트의 Users 시트를 열어 방금 만든 계정의 `password_hash`가 `pbkdf2$3000$`으로 시작하는지, 평문 비밀번호가 어디에도 없는지 확인한다.

- [ ] **Step 7: 확인용 계정 정리**

테스트로 만든 계정은 Users 시트에서 해당 행을 지운다. Sessions 시트에도 해당 `user_id`의 행이 있으면 함께 지운다.

- [ ] **Step 8: README 갱신**

`README.md`의 "최초 구축 순서" 아래에 다음 절을 추가한다.

```markdown
## 배포

프론트엔드는 GitHub Pages가 `main` 브랜치 루트에서 서빙한다. 푸시하면 1~2분 안에
`https://igm-edu.github.io/IGM_LMS/` 에 반영된다.

백엔드는 Apps Script 웹앱이다. 코드를 고친 뒤에는 업로드와 배포 갱신을 모두 해야 한다.
업로드만 하면 `/exec` 주소가 가리키는 버전은 그대로다.

```bash
cd apps-script && clasp push && clasp create-deployment --description "변경 내용"
```

새 배포 ID가 나오면 `assets/js/config.js`의 `API_URL`을 그 주소로 바꾼다.
```

- [ ] **Step 9: 커밋**

```bash
git add README.md && git commit -m "docs: 배포 절차 정리" && git push
```

---

## 완료 기준

- `npm test`가 150개 테스트를 통과하고 출력이 깨끗하다.
- `https://igm-edu.github.io/IGM_LMS/` 에서 가입·로그인·로그아웃이 동작한다.
- 새로고침해도 로그인이 유지된다.
- 잘못된 입력에 대해 서버가 준 사유가 화면에 표시된다.
- 어떤 응답에도 `password_hash`가 없다.
- 확인용으로 만든 계정이 정리되어 있다.

## 다음 계획

**클래스와 차시 관리** — 관리자가 클래스를 개설하고 차시를 등록하는 화면과 API. 이 계획에서 만든 `api.js`·`auth.js`를 그대로 쓰고, 라우팅 표에 처음으로 `roles: ['admin']` 항목이 들어간다. 그 시점에 `main.js`의 역할 검사 분기가 처음 실행되므로 반드시 검증할 것.

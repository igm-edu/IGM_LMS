'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

async function loadApi() {
  const api = await import('../assets/js/api.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
  return api;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** 유효한 세션을 심는다. */
function seedSession(api, overrides) {
  const session = Object.assign({
    access_token: 'ACCESS1',
    refresh_token: 'REFRESH1',
    expires_at: nowSec() + 3600,
    user_id: 'U-1',
  }, overrides || {});
  api.saveSession(session);
  return session;
}

const okJson = (value) => ({ text: JSON.stringify(value) });

// ---------------------------------------------------------------------------
// 요청 모양
// ---------------------------------------------------------------------------

test('REST 요청에 apikey와 Authorization을 함께 보낸다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => okJson([{ id: 'U-1' }]));

  try {
    const rows = await api.rest('/profiles?select=id');
    assert.deepStrictEqual(rows, [{ id: 'U-1' }]);

    const sent = shim.lastRequest();
    assert.strictEqual(sent.url, URL + '/rest/v1/profiles?select=id');
    assert.strictEqual(sent.options.headers.apikey, KEY);
    assert.strictEqual(sent.options.headers.Authorization, 'Bearer ACCESS1');
  } finally {
    shim.restoreFetch();
  }
});

test('rpc는 함수 경로로 POST한다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => okJson([]));

  try {
    await api.rpc('list_instructors', { a: 1 });
    const sent = shim.lastRequest();
    assert.strictEqual(sent.url, URL + '/rest/v1/rpc/list_instructors');
    assert.strictEqual(sent.options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(sent.options.body), { a: 1 });
  } finally {
    shim.restoreFetch();
  }
});

test('본문이 없는 응답은 null을 돌려준다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => ({ status: 204, text: '' }));

  try {
    assert.strictEqual(await api.rest('/profiles?id=eq.U-1', { method: 'PATCH', body: {} }), null);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 오류 변환
// ---------------------------------------------------------------------------

test('PostgREST 권한 오류를 우리 말로 바꾼다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => ({ status: 403, text: JSON.stringify({ code: '42501', message: 'permission denied' }) }));

  try {
    await assert.rejects(() => api.rest('/classes', { method: 'POST', body: {} }), (err) => {
      assert.ok(err instanceof api.ApiError);
      assert.strictEqual(err.code, '42501');
      assert.strictEqual(err.message, '권한이 없습니다.');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('제약 위반도 코드별로 다른 안내를 준다', async () => {
  const api = await loadApi();
  seedSession(api);
  const cases = [
    ['23505', '이미 존재하는 값입니다.'],
    ['23514', '입력값이 허용된 범위를 벗어났습니다.'],
    ['23503', '다른 자료가 참조하고 있어 처리할 수 없습니다.'],
  ];

  for (const [code, expected] of cases) {
    shim.installFetch(async () => ({ status: 400, text: JSON.stringify({ code: code }) }));
    try {
      await assert.rejects(() => api.rest('/classes', { method: 'POST', body: {} }), (err) => {
        assert.strictEqual(err.message, expected);
        return true;
      });
    } finally {
      shim.restoreFetch();
    }
  }
});

test('서버 함수가 raise한 메시지는 그대로 보여준다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => ({ status: 400, text: JSON.stringify({ code: 'P0001', message: '권한이 없습니다' }) }));

  try {
    await assert.rejects(() => api.rpc('admin_set_user_role', {}), (err) => {
      assert.strictEqual(err.message, '권한이 없습니다');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('인증 오류 코드를 우리 말로 바꾼다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => ({
    status: 400,
    text: JSON.stringify({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
  }));

  try {
    await assert.rejects(() => api.authCall('/token?grant_type=password', {}), (err) => {
      assert.strictEqual(err.code, 'invalid_credentials');
      assert.strictEqual(err.message, '이메일 또는 비밀번호가 올바르지 않습니다.');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 네트워크
// ---------------------------------------------------------------------------

test('네트워크 오류는 두 번까지 재시도한다', async () => {
  const api = await loadApi();
  seedSession(api);
  let calls = 0;
  shim.installFetch(async () => {
    calls += 1;
    if (calls < 3) throw new Error('network down');
    return okJson([{ ok: 1 }]);
  });

  try {
    assert.deepStrictEqual(await api.rest('/profiles'), [{ ok: 1 }]);
    assert.strictEqual(calls, 3, '첫 시도 + 재시도 2회');
  } finally {
    shim.restoreFetch();
  }
});

test('서버가 답한 오류는 재시도하지 않는다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => ({ status: 400, text: JSON.stringify({ code: '23514' }) }));

  try {
    await assert.rejects(() => api.rest('/classes', { method: 'POST', body: {} }));
    assert.strictEqual(shim.requests().length, 1, '4xx를 재시도하면 잠금 카운터만 올린다');
  } finally {
    shim.restoreFetch();
  }
});

test('JSON이 아닌 응답은 BAD_RESPONSE로 알린다', async () => {
  const api = await loadApi();
  seedSession(api);
  shim.installFetch(async () => ({ text: '<html>오류 페이지</html>' }));

  try {
    await assert.rejects(() => api.rest('/profiles'), (err) => {
      assert.strictEqual(err.code, 'BAD_RESPONSE');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 세션과 갱신
// ---------------------------------------------------------------------------

test('세션이 없으면 요청을 보내지 않고 NO_SESSION을 던진다', async () => {
  const api = await loadApi();
  shim.installFetch(async () => okJson([]));

  try {
    await assert.rejects(() => api.rest('/profiles'), (err) => {
      assert.strictEqual(err.code, 'NO_SESSION');
      return true;
    });
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

test('갱신 토큰이 빠진 세션은 없는 것으로 본다', async () => {
  const api = await loadApi();
  // 깨진 값을 들고 로그인 상태라고 착각하면 화면이 빈 채로 멈춘다.
  api.saveSession({ access_token: 'A', expires_at: nowSec() + 3600 });
  assert.strictEqual(api.getSession(), null);

  shim.installFetch(async () => okJson([]));
  try {
    await assert.rejects(() => api.rest('/profiles'), (err) => err.code === 'NO_SESSION');
  } finally {
    shim.restoreFetch();
  }
});

test('만료가 가까우면 미리 갱신하고 새 토큰으로 요청한다', async () => {
  const api = await loadApi();
  seedSession(api, { expires_at: nowSec() + 30 });   // 여유 60초보다 짧다

  shim.installFetch(async (url) => {
    if (String(url).indexOf('grant_type=refresh_token') !== -1) {
      return okJson({ access_token: 'ACCESS2', refresh_token: 'REFRESH2', expires_in: 3600 });
    }
    return okJson([{ id: 'U-1' }]);
  });

  try {
    await api.rest('/profiles');
    const [first, second] = shim.requests();
    assert.match(String(first.url), /grant_type=refresh_token/);
    assert.strictEqual(second.options.headers.Authorization, 'Bearer ACCESS2');
    // 갱신 응답에 user가 없어도 알고 있던 값을 잃지 않아야 한다.
    assert.strictEqual(api.getSession().user_id, 'U-1');
  } finally {
    shim.restoreFetch();
  }
});

test('401이 오면 한 번 갱신하고 재시도한다', async () => {
  const api = await loadApi();
  seedSession(api);   // 만료는 멀지만 서버가 거부하는 상황 (기기 시계 어긋남 등)

  let restCalls = 0;
  shim.installFetch(async (url) => {
    if (String(url).indexOf('grant_type=refresh_token') !== -1) {
      return okJson({ access_token: 'ACCESS2', refresh_token: 'REFRESH2', expires_in: 3600 });
    }
    restCalls += 1;
    if (restCalls === 1) return { status: 401, text: JSON.stringify({ message: 'JWT expired' }) };
    return okJson([{ id: 'U-1' }]);
  });

  try {
    assert.deepStrictEqual(await api.rest('/profiles'), [{ id: 'U-1' }]);
    assert.strictEqual(restCalls, 2);
    assert.strictEqual(api.getSession().access_token, 'ACCESS2');
  } finally {
    shim.restoreFetch();
  }
});

test('갱신에 실패하면 세션을 지우고 다시 로그인하라고 한다', async () => {
  const api = await loadApi();
  seedSession(api, { expires_at: nowSec() + 10 });
  shim.installFetch(async () => ({ status: 400, text: JSON.stringify({ error: 'invalid_grant' }) }));

  try {
    await assert.rejects(() => api.rest('/profiles'), (err) => {
      assert.strictEqual(err.code, 'SESSION_EXPIRED');
      return true;
    });
    // 남겨두면 화면이 계속 로그인 상태라고 착각한다.
    assert.strictEqual(api.getSession(), null);
  } finally {
    shim.restoreFetch();
  }
});

test('동시에 여러 요청이 나가도 갱신은 한 번만 한다', async () => {
  const api = await loadApi();
  seedSession(api, { expires_at: nowSec() + 10 });

  let refreshCalls = 0;
  shim.installFetch(async (url) => {
    if (String(url).indexOf('grant_type=refresh_token') !== -1) {
      refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return okJson({ access_token: 'ACCESS2', refresh_token: 'REFRESH2', expires_in: 3600 });
    }
    return okJson([]);
  });

  try {
    await Promise.all([api.rest('/profiles'), api.rest('/classes'), api.rest('/lessons')]);
    // 먼저 성공한 갱신이 리프레시 토큰을 소모하므로 두 번째 갱신은 실패한다.
    assert.strictEqual(refreshCalls, 1);
  } finally {
    shim.restoreFetch();
  }
});

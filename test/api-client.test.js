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

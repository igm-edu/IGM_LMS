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

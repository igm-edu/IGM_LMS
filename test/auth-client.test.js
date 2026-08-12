'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let auth;

async function load() {
  api = await import('../assets/js/api.js');
  auth = await import('../assets/js/auth.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
}

const PROFILE = {
  id: 'U-1', email: 'hong@igm.co.kr', name: '홍길동', phone: '010-1234-5678',
  company: '아이지엠', position: '팀장', role: 'student', status: 'active',
};

const TOKENS = { access_token: 'ACCESS1', refresh_token: 'REFRESH1', expires_in: 3600, user: { id: 'U-1' } };

function signupPayload(overrides) {
  return Object.assign({
    name: '홍길동', email: 'Hong@IGM.co.kr', password: 'abcd1234',
    phone: '010-1234-5678', company: '아이지엠', position: '팀장',
    birth_date: '1985-03-02', consent: true,
  }, overrides || {});
}

/** 인증 엔드포인트는 토큰을, REST는 프로필을 돌려주는 기본 서버. */
function installServer(overrides) {
  const opts = overrides || {};
  shim.installFetch(async (url) => {
    const path = String(url);
    if (path.indexOf('/auth/v1/') !== -1) {
      if (opts.auth) return opts.auth(path);
      return { text: JSON.stringify(TOKENS) };
    }
    if (opts.rest) return opts.rest(path);
    return { text: JSON.stringify([PROFILE]) };
  });
}

// ---------------------------------------------------------------------------
// 가입
// ---------------------------------------------------------------------------

test('가입하면 세션이 저장되고 프로필이 돌아온다', async () => {
  await load();
  installServer();

  try {
    const user = await auth.signup(signupPayload());
    assert.strictEqual(user.name, '홍길동');
    assert.strictEqual(api.getSession().access_token, 'ACCESS1');
    assert.strictEqual(api.getSession().user_id, 'U-1');
  } finally {
    shim.restoreFetch();
  }
});

test('가입 요청은 이메일을 소문자로 보내고 역할은 보내지 않는다', async () => {
  await load();
  installServer();

  try {
    await auth.signup(signupPayload());
    const body = JSON.parse(shim.requests()[0].options.body);
    assert.strictEqual(body.email, 'hong@igm.co.kr');
    // 역할을 클라이언트가 정하지 않는다는 뜻을 코드로 남긴 부분이다.
    assert.strictEqual(body.data.role, undefined);
    assert.strictEqual(body.data.name, '홍길동');
  } finally {
    shim.restoreFetch();
  }
});

test('동의하지 않거나 필수 항목이 비면 요청을 보내지 않는다', async () => {
  await load();
  installServer();

  try {
    await assert.rejects(() => auth.signup(signupPayload({ consent: false })), (err) => {
      assert.match(err.message, /동의/);
      return true;
    });
    await assert.rejects(() => auth.signup(signupPayload({ company: '' })), (err) => {
      assert.match(err.message, /company/);
      return true;
    });
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

test('비밀번호 정책을 클라이언트에서 먼저 막는다', async () => {
  await load();
  installServer();

  try {
    await assert.rejects(() => auth.signup(signupPayload({ password: 'abcdefgh' })), /숫자/);
    await assert.rejects(() => auth.signup(signupPayload({ password: 'ab1' })), /8자/);
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

test('이메일 확인이 켜져 있어 세션이 없으면 그렇다고 알려준다', async () => {
  await load();
  installServer({ auth: () => ({ text: JSON.stringify({ user: { id: 'U-1' }, access_token: null }) }) });

  try {
    // 그대로 두면 가입은 됐는데 화면은 아무 말 없이 멈춘 것처럼 보인다.
    await assert.rejects(() => auth.signup(signupPayload()), (err) => {
      assert.strictEqual(err.code, 'CONFIRM_REQUIRED');
      return true;
    });
    assert.strictEqual(api.getSession(), null);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 로그인·로그아웃
// ---------------------------------------------------------------------------

test('로그인하면 세션이 저장된다', async () => {
  await load();
  installServer();

  try {
    const user = await auth.login('  HONG@IGM.co.kr ', 'abcd1234');
    assert.strictEqual(user.email, 'hong@igm.co.kr');
    assert.strictEqual(api.getSession().access_token, 'ACCESS1');

    const first = shim.requests()[0];
    assert.match(String(first.url), /grant_type=password/);
    assert.strictEqual(JSON.parse(first.options.body).email, 'hong@igm.co.kr');
  } finally {
    shim.restoreFetch();
  }
});

test('로그인에 실패하면 세션이 남지 않는다', async () => {
  await load();
  installServer({
    auth: () => ({ status: 400, text: JSON.stringify({ error_code: 'invalid_credentials' }) }),
  });

  try {
    await assert.rejects(() => auth.login('a@b.com', 'wrongpass1'), (err) => {
      assert.strictEqual(err.message, '이메일 또는 비밀번호가 올바르지 않습니다.');
      return true;
    });
    assert.strictEqual(api.getSession(), null);
  } finally {
    shim.restoreFetch();
  }
});

test('로그아웃은 서버 호출이 실패해도 로컬 세션을 지운다', async () => {
  await load();
  installServer();
  await auth.login('a@b.com', 'abcd1234');
  shim.restoreFetch();

  shim.installFetch(async () => { throw new Error('network down'); });
  try {
    await auth.logout();
    assert.strictEqual(api.getSession(), null, '이 기기는 로그아웃 상태여야 한다');
    assert.strictEqual(auth.isLoggedIn(), false);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 프로필
// ---------------------------------------------------------------------------

test('내 프로필은 본인 id로 조회한다', async () => {
  await load();
  installServer();
  await auth.login('a@b.com', 'abcd1234');

  try {
    await auth.me();
    const last = shim.lastRequest();
    assert.match(String(last.url), /\/rest\/v1\/profiles\?select=/);
    assert.match(String(last.url), /id=eq\.U-1/);
    // 생년월일과 동의 기록은 화면에서 쓸 일이 없어 아예 요청하지 않는다.
    assert.strictEqual(String(last.url).indexOf('birth_date'), -1);
  } finally {
    shim.restoreFetch();
  }
});

test('세션은 있는데 프로필 행이 없으면 그렇다고 알려준다', async () => {
  await load();
  installServer();
  await auth.login('a@b.com', 'abcd1234');
  shim.restoreFetch();

  installServer({ rest: () => ({ text: '[]' }) });
  try {
    await assert.rejects(() => auth.me(), (err) => {
      assert.strictEqual(err.code, 'NO_PROFILE');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('프로필 수정은 허용된 항목만 보낸다', async () => {
  await load();
  installServer();
  await auth.login('a@b.com', 'abcd1234');

  try {
    await auth.updateProfile({ name: ' 새이름 ', role: 'admin', status: 'inactive', 없는항목: 'x' });
    const body = JSON.parse(shim.lastRequest().options.body);
    assert.deepStrictEqual(body, { name: '새이름' });
  } finally {
    shim.restoreFetch();
  }
});

test('비울 수 없는 항목을 비우려 하면 거부한다', async () => {
  await load();
  installServer();
  await auth.login('a@b.com', 'abcd1234');
  const before = shim.requests().length;

  try {
    await assert.rejects(() => auth.updateProfile({ name: '   ' }), (err) => {
      assert.strictEqual(err.code, 'BAD_REQUEST');
      assert.match(err.message, /name/);
      return true;
    });
    assert.strictEqual(shim.requests().length, before, '요청을 보내지도 말아야 한다');
  } finally {
    shim.restoreFetch();
  }
});

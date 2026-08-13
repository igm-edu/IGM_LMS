'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let en;

async function load() {
  api = await import('../assets/js/api.js');
  en = await import('../assets/js/enrollments.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
  api.saveSession({
    access_token: 'ACCESS1', refresh_token: 'REFRESH1',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'U-1',
  });
}

const json = (value) => ({ text: JSON.stringify(value) });

/** 경로에 따라 다른 응답을 주는 서버. */
function server(routes) {
  shim.installFetch(async (url, options) => {
    const path = String(url);
    const method = (options && options.method) || 'GET';
    for (const route of routes) {
      if (path.indexOf(route.match) !== -1 && (!route.method || route.method === method)) {
        return route.reply;
      }
    }
    return json([]);
  });
}

// ---------------------------------------------------------------------------
// 검색
// ---------------------------------------------------------------------------

test('검색어의 구분자 문자를 걷어낸다', async () => {
  await load();
  // 쉼표와 괄호는 or=(...) 의 구분자라 그대로 넣으면 조건이 달라진다.
  assert.strictEqual(en.sanitizeSearchTerm('김,철수'), '김 철수');
  assert.strictEqual(en.sanitizeSearchTerm('a)or(b'), 'a or b');
  assert.strictEqual(en.sanitizeSearchTerm('  홍길동  '), '홍길동');
  assert.strictEqual(en.sanitizeSearchTerm('*'), '');
  assert.strictEqual(en.sanitizeSearchTerm(null), '');
});

test('검색어가 있으면 이름과 이메일을 함께 본다', async () => {
  await load();
  server([{ match: '/profiles', reply: json([]) }]);

  try {
    await en.searchStudents('김철수');
    const url = decodeURIComponent(String(shim.lastRequest().url));
    assert.match(url, /or=\(name\.ilike\.\*김철수\*,email\.ilike\.\*김철수\*\)/);
    assert.match(url, /status=eq\.active/);
    assert.match(url, /limit=20/);
  } finally {
    shim.restoreFetch();
  }
});

test('검색어가 비면 필터 없이 앞부분만 가져온다', async () => {
  await load();
  server([{ match: '/profiles', reply: json([]) }]);

  try {
    await en.searchStudents('   ');
    const url = String(shim.lastRequest().url);
    assert.strictEqual(url.indexOf('or=('), -1, '빈 조건을 보내면 안 된다');
    assert.match(url, /limit=20/);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 등록
// ---------------------------------------------------------------------------

test('등록 이력이 없으면 새로 넣는다', async () => {
  await load();
  server([
    { match: '/enrollments', method: 'GET', reply: json([]) },
    { match: '/enrollments', method: 'POST', reply: json([{ id: 'E-1', status: '수강중' }]) },
  ]);

  try {
    const row = await en.enroll('U-2', 'C-1');
    assert.strictEqual(row.status, '수강중');
    const sent = shim.lastRequest();
    assert.strictEqual(sent.options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(sent.options.body), { user_id: 'U-2', class_id: 'C-1' });
  } finally {
    shim.restoreFetch();
  }
});

test('취소했던 사람은 새 행을 만들지 않고 상태만 되돌린다', async () => {
  await load();
  server([
    { match: '/enrollments', method: 'GET', reply: json([{ id: 'E-9', status: '취소' }]) },
    { match: '/enrollments', method: 'PATCH', reply: json([{ id: 'E-9', status: '수강중' }]) },
  ]);

  try {
    const row = await en.enroll('U-2', 'C-1');
    assert.strictEqual(row.status, '수강중');
    const sent = shim.lastRequest();
    // (user_id, class_id) 유니크 제약이 있어 두 번째 insert 는 실패한다.
    assert.strictEqual(sent.options.method, 'PATCH');
    assert.match(String(sent.url), /id=eq\.E-9/);
  } finally {
    shim.restoreFetch();
  }
});

test('이미 수강 중이면 알려주고 요청을 더 보내지 않는다', async () => {
  await load();
  server([{ match: '/enrollments', method: 'GET', reply: json([{ id: 'E-9', status: '수강중' }]) }]);

  try {
    await assert.rejects(() => en.enroll('U-2', 'C-1'), (err) => {
      assert.strictEqual(err.code, 'ALREADY_ENROLLED');
      return true;
    });
    assert.strictEqual(shim.requests().length, 1, '조회 한 번으로 끝나야 한다');
  } finally {
    shim.restoreFetch();
  }
});

test('수강생이나 클래스가 비면 요청하지 않는다', async () => {
  await load();
  server([{ match: '/enrollments', reply: json([]) }]);

  try {
    await assert.rejects(() => en.enroll('', 'C-1'), /지정해 주세요/);
    await assert.rejects(() => en.enroll('U-2', ''), /지정해 주세요/);
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

test('정책이 걸러 0건이 오면 등록된 것처럼 넘기지 않는다', async () => {
  await load();
  server([
    { match: '/enrollments', method: 'GET', reply: json([]) },
    { match: '/enrollments', method: 'POST', reply: json([]) },
  ]);

  try {
    await assert.rejects(() => en.enroll('U-2', 'C-1'), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 취소와 명단
// ---------------------------------------------------------------------------

test('취소는 행을 지우지 않고 상태만 바꾼다', async () => {
  await load();
  server([{ match: '/enrollments', method: 'PATCH', reply: json([{ id: 'E-1', status: '취소' }]) }]);

  try {
    await en.cancelEnrollment('U-2', 'C-1');
    const sent = shim.lastRequest();
    // 시청 기록을 남겨 두어야 다시 등록했을 때 진도가 이어진다.
    assert.strictEqual(sent.options.method, 'PATCH');
    assert.deepStrictEqual(JSON.parse(sent.options.body), { status: '취소' });
    assert.match(String(sent.url), /user_id=eq\.U-2/);
    assert.match(String(sent.url), /class_id=eq\.C-1/);
  } finally {
    shim.restoreFetch();
  }
});

test('대상이 없으면 취소된 것처럼 넘기지 않는다', async () => {
  await load();
  server([{ match: '/enrollments', method: 'PATCH', reply: json([]) }]);

  try {
    await assert.rejects(() => en.cancelEnrollment('U-2', 'C-1'), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('명단은 서버 함수로 가져온다', async () => {
  await load();
  server([{ match: '/rpc/class_roster', reply: json([]) }]);

  try {
    await en.listRoster('C-1');
    const sent = shim.lastRequest();
    assert.match(String(sent.url), /\/rpc\/class_roster$/);
    assert.deepStrictEqual(JSON.parse(sent.options.body), { cid: 'C-1' });
  } finally {
    shim.restoreFetch();
  }
});

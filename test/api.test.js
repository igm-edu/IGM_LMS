'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const main = require('../apps-script/main');

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
}

function post(action, payload, token) {
  const body = JSON.stringify({ action, token, payload });
  const output = main.doPost({ postData: { contents: body } });
  return JSON.parse(output.getContent());
}

const SIGNUP = {
  name: '홍길동', email: 'Hong@IGM.co.kr', password: 'abcd1234',
  phone: '010-1234-5678', company: '아이지엠', position: '팀장',
  birth_date: '1985-03-02', consent: true,
};

test('가입 → 로그인 → 내 정보 조회가 한 흐름으로 동작한다', () => {
  fresh();

  const signup = post('auth.signup', SIGNUP);
  assert.strictEqual(signup.ok, true);
  assert.ok(signup.data.token);

  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  assert.strictEqual(login.ok, true);

  const me = post('auth.me', {}, login.data.token);
  assert.strictEqual(me.ok, true);
  assert.strictEqual(me.data.email, 'hong@igm.co.kr');
  assert.strictEqual(me.data.name, '홍길동');
});

test('어떤 응답에도 비밀번호 해시가 실리지 않는다', () => {
  fresh();
  const signup = post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  const me = post('auth.me', {}, login.data.token);

  [signup, login, me].forEach((response) => {
    assert.strictEqual(JSON.stringify(response).indexOf('pbkdf2'), -1);
    assert.strictEqual(JSON.stringify(response).indexOf('password_hash'), -1);
  });
});

test('토큰 없이 보호된 기능을 부르면 거부된다', () => {
  fresh();
  const response = post('auth.me', {});
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'TOKEN_INVALID');
});

test('라우팅 표의 PUBLIC이 아닌 모든 action이 토큰을 요구한다', () => {
  fresh();
  const routes = main.routes_();
  const guarded = Object.keys(routes).filter((action) => routes[action].roles !== main.PUBLIC);
  assert.ok(guarded.length >= 3, '보호되는 action이 있어야 이 검사가 의미를 가진다');

  guarded.forEach((action) => {
    const response = post(action, {});
    assert.strictEqual(response.ok, false, `${action}이 토큰 없이 통과했다`);
    assert.strictEqual(response.error.code, 'TOKEN_INVALID', `${action}의 오류 코드가 다르다`);
  });
});

test('모든 라우팅 항목이 실제 함수를 가리킨다', () => {
  const routes = main.routes_();
  Object.keys(routes).forEach((action) => {
    assert.strictEqual(typeof routes[action].handler, 'function', `${action}의 핸들러가 함수가 아니다`);
    assert.ok(routes[action].roles, `${action}에 roles가 없다`);
  });
});

test('알 수 없는 action은 UNKNOWN_ACTION', () => {
  fresh();
  const response = post('없는.기능', {});
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'UNKNOWN_ACTION');
});

test('본문이 JSON이 아니면 BAD_REQUEST이고 ErrorLog에 남기지 않는다', () => {
  fresh();
  const output = main.doPost({ postData: { contents: '{망가진 본문' } });
  const response = JSON.parse(output.getContent());
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'BAD_REQUEST');
  assert.deepStrictEqual(sheet.readAll('ErrorLog'), []);
});

test('로그인 실패는 ErrorLog를 채우지 않는다', () => {
  fresh();
  post('auth.signup', SIGNUP);
  for (let i = 0; i < 3; i += 1) {
    post('auth.login', { email: 'hong@igm.co.kr', password: 'wrongpass1' });
  }
  assert.deepStrictEqual(sheet.readAll('ErrorLog'), []);
});

test('예기치 못한 예외는 ErrorLog에 남고 내부 사정을 노출하지 않는다', () => {
  fresh();
  main.routes_()['test.boom'] = {
    handler: function () { throw new Error('내부 스택 추적 정보'); },
    roles: main.PUBLIC,
  };

  try {
    const response = post('test.boom', {});
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'INTERNAL');
    assert.strictEqual(response.error.message.indexOf('내부 스택 추적'), -1);

    const logs = sheet.readAll('ErrorLog');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, 'test.boom');
    assert.match(logs[0].message, /내부 스택 추적/);
  } finally {
    delete main.routes_()['test.boom'];
  }
});

test('로그아웃하면 그 토큰이 더는 통하지 않는다', () => {
  fresh();
  post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  const token = login.data.token;

  assert.strictEqual(post('auth.me', {}, token).ok, true);
  assert.strictEqual(post('auth.logout', {}, token).ok, true);

  const after = post('auth.me', {}, token);
  assert.strictEqual(after.ok, false);
  assert.strictEqual(after.error.code, 'TOKEN_INVALID');
});

test('roles가 배열이 아닌 라우트는 통과시키지 않고 기록한다', () => {
  fresh();
  post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });

  main.routes_()['test.badroles'] = { handler: function () { return { reached: true }; }, roles: 'admin' };

  try {
    const response = post('test.badroles', {}, login.data.token);
    assert.strictEqual(response.ok, false, '잘못된 roles는 통과해서는 안 된다');
    assert.strictEqual(response.error.code, 'INTERNAL');
    assert.strictEqual(sheet.readAll('ErrorLog').length, 1);
  } finally {
    delete main.routes_()['test.badroles'];
  }
});

test('배열 roles는 역할이 맞지 않으면 FORBIDDEN', () => {
  fresh();
  post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });

  main.routes_()['test.adminonly'] = { handler: function () { return { reached: true }; }, roles: ['admin'] };

  try {
    const response = post('test.adminonly', {}, login.data.token);
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'FORBIDDEN');
  } finally {
    delete main.routes_()['test.adminonly'];
  }
});

test('Object 프로토타입 속성 이름도 UNKNOWN_ACTION으로 거부한다', () => {
  fresh();
  ['constructor', 'toString', 'hasOwnProperty', '__proto__'].forEach((name) => {
    const response = post(name, {});
    assert.strictEqual(response.ok, false, `${name}이 통과했다`);
    assert.strictEqual(response.error.code, 'UNKNOWN_ACTION', `${name}의 오류 코드가 다르다`);
  });
});

test('doGet은 상태만 알려주고 데이터를 다루지 않는다', () => {
  fresh();
  const response = JSON.parse(main.doGet().getContent());
  assert.strictEqual(response.ok, true);
  assert.strictEqual(JSON.stringify(response).indexOf('password'), -1);
});

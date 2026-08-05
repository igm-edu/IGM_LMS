'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const auth = require('../apps-script/handlers/auth');

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
}

function signupPayload(overrides) {
  const base = {
    name: '홍길동',
    email: 'Hong@IGM.co.kr',
    password: 'abcd1234',
    phone: '010-1234-5678',
    company: '아이지엠',
    position: '팀장',
    birth_date: '1985-03-02',
    consent: true,
  };
  return Object.assign(base, overrides || {});
}

test('publicUser_는 비밀번호 해시를 절대 포함하지 않는다', () => {
  const row = {
    user_id: 'U1', name: '홍길동', email: 'a@b.com',
    password_hash: 'pbkdf2$3000$aaaa$bbbb',
    phone: '010', company: '회사', position: '직급', birth_date: '1985-03-02',
    role: 'student', status: 'active',
    consent_at: new Date(), retention_until: new Date(), created_at: new Date(),
  };
  const out = auth.publicUser_(row);
  assert.strictEqual(out.password_hash, undefined);
  assert.strictEqual(JSON.stringify(out).indexOf('pbkdf2'), -1);
});

test('publicUser_는 생년월일과 동의 기록도 내보내지 않는다', () => {
  const out = auth.publicUser_({
    user_id: 'U1', birth_date: '1985-03-02',
    consent_at: 'x', retention_until: 'y', password_hash: 'z',
  });
  assert.strictEqual(out.birth_date, undefined);
  assert.strictEqual(out.consent_at, undefined);
  assert.strictEqual(out.retention_until, undefined);
});

test('publicUser_는 시트에 열이 추가되어도 그대로 흘려보내지 않는다', () => {
  const out = auth.publicUser_({ user_id: 'U1', 나중에추가된열: '비밀' });
  assert.strictEqual(out['나중에추가된열'], undefined);
});

test('가입하면 계정이 만들어지고 토큰이 함께 발급된다', () => {
  fresh();
  const result = auth.handleSignup(signupPayload());

  assert.ok(result.token, '토큰이 발급되어야 한다');
  assert.strictEqual(result.user.name, '홍길동');
  assert.strictEqual(result.user.role, 'student');
  assert.strictEqual(result.user.password_hash, undefined);
  assert.strictEqual(sheet.readAll('Sessions').length, 1);
});

test('가입 시 이메일은 소문자로 저장된다', () => {
  fresh();
  const result = auth.handleSignup(signupPayload());
  assert.strictEqual(result.user.email, 'hong@igm.co.kr');
  assert.ok(sheet.findByColumn('Users', 'email', 'hong@igm.co.kr'));
});

test('대소문자만 다른 이메일로는 중복 가입할 수 없다', () => {
  fresh();
  auth.handleSignup(signupPayload({ email: 'hong@igm.co.kr' }));
  assert.throws(() => auth.handleSignup(signupPayload({ email: 'HONG@IGM.CO.KR' })), (err) => {
    assert.strictEqual(err.appCode, 'EMAIL_TAKEN');
    return true;
  });
  assert.strictEqual(sheet.readAll('Users').length, 1);
});

test('필수 항목이 비면 무엇이 빠졌는지 알려주며 거부한다', () => {
  fresh();
  assert.throws(() => auth.handleSignup(signupPayload({ company: '' })), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /company/);
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('동의하지 않으면 가입되지 않는다', () => {
  fresh();
  [false, undefined, 'true'].forEach((value) => {
    assert.throws(() => auth.handleSignup(signupPayload({ consent: value })), (err) => {
      assert.strictEqual(err.appCode, 'BAD_REQUEST');
      return true;
    });
  });
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('비밀번호 정책과 이메일 형식을 검사한다', () => {
  fresh();
  assert.throws(() => auth.handleSignup(signupPayload({ password: 'abcdefgh' })), /숫자/);
  assert.throws(() => auth.handleSignup(signupPayload({ email: '이상한주소' })), /이메일 형식/);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('가입 시 동의 시각과 보관 만료일이 기록된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const row = sheet.findByColumn('Users', 'email', 'hong@igm.co.kr');
  assert.ok(row.consent_at, '동의 시각이 있어야 한다');
  const created = new Date(row.created_at);
  const retention = new Date(row.retention_until);
  assert.strictEqual(retention.getFullYear() - created.getFullYear(), 3);
});

test('비밀번호는 해시로만 저장된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const row = sheet.findByColumn('Users', 'email', 'hong@igm.co.kr');
  assert.match(row.password_hash, /^pbkdf2\$/);
  assert.strictEqual(String(row.password_hash).indexOf('abcd1234'), -1);
});

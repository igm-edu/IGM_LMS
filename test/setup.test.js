'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const { SHEETS } = require('../apps-script/schema');
const sheet = require('../apps-script/lib/sheet');
const hash = require('../apps-script/lib/hash');
const setup = require('../apps-script/setup');

function emptySpreadsheet() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  return fake.installSpreadsheetApp(SPREADSHEET_ID);
}

test('setupSheets가 13개 시트를 헤더와 함께 만든다', () => {
  const spreadsheet = emptySpreadsheet();
  const result = setup.setupSheets();

  assert.strictEqual(result.created.length, 13);
  Object.keys(SHEETS).forEach((name) => {
    const created = spreadsheet.getSheetByName(name);
    assert.ok(created, `${name} 시트가 없다`);
    const headers = created.getRange(1, 1, 1, SHEETS[name].length).getValues()[0];
    assert.deepStrictEqual(headers, SHEETS[name], `${name}의 헤더가 다르다`);
  });
});

test('두 번 실행해도 시트가 중복 생성되지 않는다', () => {
  const spreadsheet = emptySpreadsheet();
  setup.setupSheets();
  const second = setup.setupSheets();

  assert.strictEqual(second.created.length, 0);
  assert.strictEqual(spreadsheet.getSheets().length, 13);
});

test('setupSheets는 기존 데이터를 지우지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '기존회원' });

  setup.setupSheets();

  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '기존회원');
});

test('헤더가 일부 빠진 시트에는 빠진 열만 뒤에 추가한다', () => {
  const spreadsheet = emptySpreadsheet();
  const users = spreadsheet.insertSheet('Users');
  users.appendRow(['user_id', 'name', 'email']);
  users.appendRow(['U1', '홍길동', 'a@b.com']);

  const result = setup.setupSheets();

  assert.ok(result.extended.some((entry) => entry.startsWith('Users:')));
  const headers = users.getRange(1, 1, 1, SHEETS.Users.length).getValues()[0];
  assert.deepStrictEqual(headers.slice(0, 3), ['user_id', 'name', 'email']);
  assert.strictEqual(new Set(headers).size, SHEETS.Users.length);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '홍길동');
});

test('seedAdmin이 검증 가능한 해시를 가진 관리자를 만든다', () => {
  emptySpreadsheet();
  setup.setupSheets();

  const result = setup.seedAdmin('admin@igm.co.kr', '초기비밀번호1234', '운영자');

  assert.strictEqual(result.skipped, false);
  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(admin.status, 'active');
  assert.strictEqual(admin.name, '운영자');
  assert.strictEqual(hash.verifyPassword('초기비밀번호1234', admin.password_hash), true);
  assert.strictEqual(hash.verifyPassword('틀린비밀번호', admin.password_hash), false);
});

test('seedAdmin은 비밀번호를 평문으로 남기지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('admin@igm.co.kr', '평문금지1234');

  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  assert.ok(!String(admin.password_hash).includes('평문금지1234'));
});

test('seedAdmin은 보관 만료일을 3년 뒤로 설정한다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('admin@igm.co.kr', '비밀번호1234');

  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  const created = new Date(admin.created_at);
  const retention = new Date(admin.retention_until);
  assert.strictEqual(retention.getFullYear() - created.getFullYear(), 3);
});

test('관리자가 이미 있으면 seedAdmin은 아무것도 하지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('first@igm.co.kr', '비밀번호1234');

  const result = setup.seedAdmin('second@igm.co.kr', '비밀번호1234');

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(sheet.findBy('Users', 'email', 'second@igm.co.kr'), null);
});

test('resetAllSheets는 확인 문자열 없이는 동작하지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '지워지면안됨' });

  assert.throws(() => setup.resetAllSheets(), /확인 문자열/);
  assert.throws(() => setup.resetAllSheets('아무거나'), /확인 문자열/);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '지워지면안됨');
});

test('resetAllSheets는 확인 문자열이 맞으면 전부 비우고 다시 만든다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '지워짐' });

  const result = setup.resetAllSheets(setup.RESET_CONFIRMATION);

  assert.strictEqual(result.created.length, 13);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('관리 대상 시트만 있는 상태에서도 resetAllSheets가 끝까지 완료된다', () => {
  const spreadsheet = emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '지워짐' });
  assert.strictEqual(spreadsheet.getSheets().length, 13);

  setup.resetAllSheets(setup.RESET_CONFIRMATION);

  assert.strictEqual(spreadsheet.getSheets().length, 13);
  assert.strictEqual(spreadsheet.getSheetByName(setup.RESET_PLACEHOLDER_NAME), null);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('임시 시트가 남아 있어도 resetAllSheets가 동작한다', () => {
  const spreadsheet = emptySpreadsheet();
  setup.setupSheets();
  spreadsheet.insertSheet(setup.RESET_PLACEHOLDER_NAME);

  setup.resetAllSheets(setup.RESET_CONFIRMATION);

  assert.strictEqual(spreadsheet.getSheets().length, 13);
  assert.strictEqual(spreadsheet.getSheetByName(setup.RESET_PLACEHOLDER_NAME), null);
});

test('인자 없이 호출하면 스크립트 속성에서 관리자 정보를 읽는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  const props = shim.PropertiesService.getScriptProperties();
  props.setProperty(setup.SEED_EMAIL_PROPERTY, 'admin@igm.co.kr');
  props.setProperty(setup.SEED_PASSWORD_PROPERTY, '속성으로넘긴비밀번호');
  props.setProperty(setup.SEED_NAME_PROPERTY, '운영자');

  const result = setup.seedAdmin();

  assert.strictEqual(result.skipped, false);
  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  assert.strictEqual(admin.name, '운영자');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(hash.verifyPassword('속성으로넘긴비밀번호', admin.password_hash), true);
});

test('계정을 만든 뒤 초기 비밀번호 속성을 지운다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  const props = shim.PropertiesService.getScriptProperties();
  props.setProperty(setup.SEED_EMAIL_PROPERTY, 'admin@igm.co.kr');
  props.setProperty(setup.SEED_PASSWORD_PROPERTY, '지워져야하는비밀번호');
  props.setProperty(setup.SEED_NAME_PROPERTY, '운영자');

  setup.seedAdmin();

  assert.strictEqual(props.getProperty(setup.SEED_PASSWORD_PROPERTY), null);
  assert.strictEqual(props.getProperty(setup.SEED_EMAIL_PROPERTY), null);
  assert.strictEqual(props.getProperty(setup.SEED_NAME_PROPERTY), null);
});

test('속성도 인자도 없으면 무엇을 등록해야 하는지 알려주며 실패한다', () => {
  emptySpreadsheet();
  setup.setupSheets();

  assert.throws(() => setup.seedAdmin(), /SEED_ADMIN_PASSWORD/);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

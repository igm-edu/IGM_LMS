'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const { SHEETS } = require('../apps-script/schema');
const sheet = require('../apps-script/lib/sheet');

function freshSpreadsheet() {
  shim.resetShim();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  const spreadsheet = fake.installSpreadsheetApp(SPREADSHEET_ID);
  const users = spreadsheet.insertSheet('Users');
  users.appendRow(SHEETS.Users);
  return { spreadsheet, users };
}

test('SPREADSHEET_ID가 없으면 안내 메시지와 함께 예외를 던진다', () => {
  shim.resetShim();
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  assert.throws(() => sheet.readAll('Users'), /SPREADSHEET_ID/);
});

test('시트가 없으면 setupSheets 안내와 함께 예외를 던진다', () => {
  shim.resetShim();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  assert.throws(() => sheet.readAll('Users'), /setupSheets/);
});

test('헤더만 있는 시트는 빈 배열을 반환한다', () => {
  freshSpreadsheet();
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('insert한 레코드를 기본키로 찾을 수 있다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동', email: 'a@b.com' });
  const found = sheet.findByPk('Users', 'U1');
  assert.strictEqual(found.name, '홍길동');
  assert.strictEqual(found.email, 'a@b.com');
});

test('정의되지 않은 열은 빈 문자열로 저장된다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동' });
  assert.strictEqual(sheet.findByPk('Users', 'U1').phone, '');
});

test('없는 기본키는 null을 반환한다', () => {
  freshSpreadsheet();
  assert.strictEqual(sheet.findByPk('Users', '없는키'), null);
});

test('findBy로 기본키가 아닌 열로도 찾을 수 있다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', email: 'a@b.com' });
  sheet.insert('Users', { user_id: 'U2', email: 'c@d.com' });
  assert.strictEqual(sheet.findBy('Users', 'email', 'c@d.com').user_id, 'U2');
  assert.strictEqual(sheet.findBy('Users', 'email', 'x@y.com'), null);
});

test('update는 지정한 열만 바꾸고 나머지를 보존한다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동', email: 'a@b.com' });
  sheet.update('Users', 'U1', { name: '김철수' });
  const found = sheet.findByPk('Users', 'U1');
  assert.strictEqual(found.name, '김철수');
  assert.strictEqual(found.email, 'a@b.com');
});

test('update는 기본키를 바꾸지 못한다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동' });
  sheet.update('Users', 'U1', { user_id: 'U999', name: '김철수' });
  assert.strictEqual(sheet.findByPk('Users', 'U999'), null);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '김철수');
});

test('upsert는 없으면 만들고 있으면 갱신한다', () => {
  freshSpreadsheet();
  sheet.upsert('Users', { user_id: 'U1', name: '처음' });
  sheet.upsert('Users', { user_id: 'U1', name: '나중' });
  assert.strictEqual(sheet.readAll('Users').length, 1);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '나중');
});

test('시트를 직접 편집해 행이 밀려도 올바른 레코드를 찾는다', () => {
  const { users } = freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째' });

  // 캐시에 U2의 행 번호를 채운다
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');

  // 관리자가 시트에서 첫 번째 데이터 행을 직접 지운 상황
  users.deleteRow(2);

  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');
  assert.strictEqual(sheet.findByPk('Users', 'U1'), null);
});

test('deleteByPk는 해당 행만 지운다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째' });
  assert.strictEqual(sheet.deleteByPk('Users', 'U1'), true);
  assert.strictEqual(sheet.deleteByPk('Users', '없는키'), false);
  assert.strictEqual(sheet.readAll('Users').length, 1);
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');
});

test('newId는 접두어를 붙인 고유 문자열을 만든다', () => {
  const a = sheet.newId('U');
  const b = sheet.newId('U');
  assert.match(a, /^U[0-9A-F]{12}$/);
  assert.notStrictEqual(a, b);
});

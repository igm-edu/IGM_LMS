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
  sheet.resetSpreadsheetCache_();
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

function userRow_(userId, name) {
  return SHEETS.Users.map((header) => {
    if (header === 'user_id') return userId;
    if (header === 'name') return name;
    return '';
  });
}

test('행 개수는 그대로인데 순서가 바뀌어도 올바른 레코드를 찾는다', () => {
  const { users } = freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째' });

  // 캐시에 U1=행2, U2=행3을 채운다
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '첫째');
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');

  // 관리자가 시트를 정렬해 두 행을 맞바꿨다. 행 개수는 그대로이므로
  // 캐시의 행 번호는 범위 안에 있고, A열 값 대조만이 어긋남을 잡아낼 수 있다.
  users.getRange(2, 1, 2, SHEETS.Users.length).setValues([
    userRow_('U2', '둘째'),
    userRow_('U1', '첫째'),
  ]);

  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '첫째');
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');
});

test('한 실행 안에서는 스프레드시트를 한 번만 연다', () => {
  freshSpreadsheet();
  const opened = [];
  const inner = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    openById(id) {
      opened.push(id);
      return inner.openById(id);
    },
  };

  try {
    sheet.insert('Users', { user_id: 'U1', name: '첫째' });
    sheet.findByPk('Users', 'U1');
    sheet.readAll('Users');
    assert.strictEqual(opened.length, 1);
  } finally {
    global.SpreadsheetApp = inner;
  }
});

test('같은 기본키로 두 번 insert하면 거부한다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  assert.throws(
    () => sheet.insert('Users', { user_id: 'U1', name: '중복' }),
    /이미 존재하는 기본키/
  );
  assert.strictEqual(sheet.readAll('Users').length, 1);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '첫째');
});

test('기본키가 비어 있으면 insert를 거부한다', () => {
  freshSpreadsheet();
  assert.throws(() => sheet.insert('Users', { name: '이름만' }), /기본키가 비어 있습니다/);
  assert.strictEqual(sheet.readAll('Users').length, 0);
});

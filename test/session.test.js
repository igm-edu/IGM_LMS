'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const session = require('../apps-script/lib/session');

const HOUR = 60 * 60 * 1000;

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Users', {
    user_id: 'U1', name: '홍길동', email: 'hong@igm.co.kr',
    role: 'student', status: 'active',
  });
}

test('sessionStatus_는 만료·연장·유효를 구분한다', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() - 1), now), 'expired');
  assert.strictEqual(session.sessionStatus_(now, now), 'expired');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 5 * HOUR), now), 'renew');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 6 * HOUR), now), 'renew');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 7 * HOUR), now), 'valid');
});

test('토큰 원문은 시트에 저장되지 않는다', () => {
  fresh();
  const token = session.issueSession('U1');
  const rows = sheet.readAll('Sessions');
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].token_hash, token);
  assert.strictEqual(rows[0].user_id, 'U1');
});

test('발급한 토큰으로 사용자를 얻는다', () => {
  fresh();
  const token = session.issueSession('U1');
  const user = session.verifySession(token);
  assert.strictEqual(user.user_id, 'U1');
  assert.strictEqual(user.name, '홍길동');
});

test('토큰이 없거나 모르는 값이면 TOKEN_INVALID', () => {
  fresh();
  ['', null, undefined, '알수없는토큰'].forEach((bad) => {
    assert.throws(() => session.verifySession(bad), (err) => {
      assert.strictEqual(err.appCode, 'TOKEN_INVALID');
      return true;
    });
  });
});

test('만료된 토큰은 TOKEN_EXPIRED이고 세션이 삭제된다', () => {
  fresh();
  const issuedAt = new Date('2026-08-05T00:00:00Z');
  const token = session.issueSession('U1', issuedAt);
  const later = new Date(issuedAt.getTime() + 25 * HOUR);

  assert.throws(() => session.verifySession(token, later), (err) => {
    assert.strictEqual(err.appCode, 'TOKEN_EXPIRED');
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
});

test('만료가 임박하면 연장하고, 방금 연장한 토큰은 다시 연장하지 않는다', () => {
  fresh();
  const issuedAt = new Date('2026-08-05T00:00:00Z');
  const token = session.issueSession('U1', issuedAt);
  const original = new Date(sheet.readAll('Sessions')[0].expires_at).getTime();

  // 만료 5시간 전 → 연장된다
  const nearExpiry = new Date(issuedAt.getTime() + 19 * HOUR);
  session.verifySession(token, nearExpiry);
  const renewed = new Date(sheet.readAll('Sessions')[0].expires_at).getTime();
  assert.ok(renewed > original, '연장되어야 한다');

  // 연장 직후에는 남은 시간이 24시간이라 다시 연장되지 않는다
  const rightAfter = new Date(nearExpiry.getTime() + 1 * HOUR);
  session.verifySession(token, rightAfter);
  assert.strictEqual(new Date(sheet.readAll('Sessions')[0].expires_at).getTime(), renewed);
});

test('비활성 계정은 토큰이 있어도 거부된다', () => {
  fresh();
  const token = session.issueSession('U1');
  sheet.update('Users', 'U1', { status: 'inactive' });

  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'ACCOUNT_INACTIVE');
    return true;
  });
});

test('사용자가 사라진 세션은 TOKEN_INVALID이고 정리된다', () => {
  fresh();
  const token = session.issueSession('U1');
  sheet.deleteByPk('Users', 'U1');

  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'TOKEN_INVALID');
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
});

test('revokeSession은 세션을 지운다', () => {
  fresh();
  const token = session.issueSession('U1');
  assert.strictEqual(session.revokeSession(token), true);
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
  assert.strictEqual(session.revokeSession(token), false);
  assert.strictEqual(session.revokeSession(''), false);
});

test('비활성 계정의 세션은 삭제되어 재활성화 후에도 재로그인이 필요하다', () => {
  fresh();
  const token = session.issueSession('U1');
  sheet.update('Users', 'U1', { status: 'inactive' });

  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'ACCOUNT_INACTIVE');
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Sessions'), [], '세션 행이 지워져야 한다');

  // 다시 활성화해도 그 토큰은 되살아나지 않는다
  sheet.update('Users', 'U1', { status: 'active' });
  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'TOKEN_INVALID');
    return true;
  });
});

/**
 * 시트 초기 구성. Apps Script 편집기에서 직접 실행한다.
 *
 * 실행 순서
 *   1. 프로젝트 설정 > 스크립트 속성에 SPREADSHEET_ID 등록
 *   2. setupSheets() 실행
 *   3. seedAdmin('관리자이메일', '초기비밀번호') 실행
 */

var RESET_CONFIRMATION = '모든데이터를삭제합니다';
var RETENTION_YEARS = 3;

/**
 * 없는 시트를 만들고 헤더를 채운다.
 * 이미 있는 시트는 빠진 헤더만 뒤에 덧붙이며, 기존 데이터는 절대 건드리지 않는다.
 */
function setupSheets() {
  var spreadsheet = getSpreadsheet_();
  var created = [];
  var extended = [];

  Object.keys(SHEETS).forEach(function (name) {
    var headers = SHEETS[name];
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      created.push(name);
      return;
    }

    var width = Math.max(sheet.getLastColumn(), headers.length);
    var existing = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
    while (existing.length && existing[existing.length - 1] === '') {
      existing.pop();
    }

    var missing = headers.filter(function (header) {
      return existing.indexOf(header) === -1;
    });

    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      extended.push(name + ': ' + missing.join(', '));
    }
  });

  return { created: created, extended: extended };
}

/** 최초 관리자 계정을 만든다. 이미 관리자가 있으면 아무것도 하지 않는다. */
function seedAdmin(email, password, name) {
  if (!email || !password) {
    throw new Error('seedAdmin(email, password, name) 형태로 이메일과 비밀번호를 넘겨야 합니다.');
  }

  var existing = findBy('Users', 'role', 'admin');
  if (existing) {
    return { skipped: true, reason: '이미 관리자 계정이 있습니다: ' + existing.email };
  }

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var user = {
    user_id: newId('U'),
    name: name || '관리자',
    email: email,
    password_hash: hashPassword(password),
    phone: '',
    company: '',
    position: '',
    birth_date: '',
    role: 'admin',
    status: 'active',
    consent_at: now,
    retention_until: retention,
    created_at: now,
  };

  insert('Users', user);
  return { skipped: false, user_id: user.user_id };
}

/**
 * 전체 시트를 지우고 다시 만든다. 되돌릴 수 없다.
 * 확인 문자열이 정확히 일치할 때만 동작한다.
 */
function resetAllSheets(confirmation) {
  if (confirmation !== RESET_CONFIRMATION) {
    throw new Error(
      '확인 문자열이 일치하지 않습니다. resetAllSheets("' + RESET_CONFIRMATION + '") 형태로 호출하세요.'
    );
  }

  var spreadsheet = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (sheet) spreadsheet.deleteSheet(sheet);
  });

  return setupSheets();
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./lib/sheet');
  global.SHEETS = require('./schema').SHEETS;
  global.getSpreadsheet_ = sheetLib.getSpreadsheet_;
  global.findBy = sheetLib.findBy;
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.hashPassword = require('./lib/hash').hashPassword;

  module.exports = {
    RESET_CONFIRMATION: RESET_CONFIRMATION,
    setupSheets: setupSheets,
    seedAdmin: seedAdmin,
    resetAllSheets: resetAllSheets,
  };
}

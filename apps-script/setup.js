/**
 * 시트 초기 구성. Apps Script 편집기에서 직접 실행한다.
 *
 * 실행 순서
 *   1. 프로젝트 설정 > 스크립트 속성에 SPREADSHEET_ID 등록
 *   2. setupSheets() 실행
 *   3. 스크립트 속성에 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD와
 *      필요하면 SEED_ADMIN_NAME을 등록한 뒤 seedAdmin() 실행
 *      (세 속성은 실행 후 자동으로 삭제된다)
 */

var RESET_CONFIRMATION = '모든데이터를삭제합니다';
var RESET_PLACEHOLDER_NAME = '__reset_tmp__';
var RETENTION_YEARS = 3;
var SEED_EMAIL_PROPERTY = 'SEED_ADMIN_EMAIL';
var SEED_PASSWORD_PROPERTY = 'SEED_ADMIN_PASSWORD';
var SEED_NAME_PROPERTY = 'SEED_ADMIN_NAME';

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

/**
 * 최초 관리자 계정을 만든다. 이미 관리자가 있으면 아무것도 하지 않는다.
 *
 * 인자 없이 호출하면 스크립트 속성 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD /
 * SEED_ADMIN_NAME(선택)에서 값을 읽는다. Apps Script 편집기의 실행 버튼은 인자 없는
 * 함수만 호출할 수 있어서, 비밀번호를 코드에 적지 않고 계정을 만들려면 이 경로가
 * 필요하다. 세 속성은 계정을 만든 뒤에도, 이미 관리자가 있어 건너뛴 경우에도 지운다.
 * 초기 비밀번호가 프로젝트 설정에 남는 경로를 만들지 않기 위해서다.
 *
 * "이미 관리자가 있는지"를 자격 증명 검사보다 먼저 확인하는 이유가 있다. 이 함수는
 * 실행 버튼으로 호출되므로 세팅을 마친 뒤 다시 눌러보는 일이 흔한데, 순서가 반대면
 * "이미 있습니다"라는 안내 대신 "비밀번호를 등록하세요"라는 오해를 부르는 오류가
 * 나고, 그 안내를 따라 등록한 비밀번호가 건너뛰기 경로에 남게 된다.
 */
function seedAdmin(email, password, name) {
  var props = PropertiesService.getScriptProperties();

  var existing = findBy('Users', 'role', 'admin');
  if (existing) {
    clearSeedProperties_(props);
    return { skipped: true, reason: '이미 관리자 계정이 있습니다: ' + existing.email };
  }

  var adminEmail = email || props.getProperty(SEED_EMAIL_PROPERTY);
  var adminPassword = password || props.getProperty(SEED_PASSWORD_PROPERTY);
  var adminName = name || props.getProperty(SEED_NAME_PROPERTY);

  var missing = [];
  if (!adminEmail) missing.push(SEED_EMAIL_PROPERTY);
  if (!adminPassword) missing.push(SEED_PASSWORD_PROPERTY);
  if (missing.length) {
    throw new Error(
      '관리자 정보가 없습니다. 프로젝트 설정 > 스크립트 속성에 ' + missing.join(', ') +
      '를 등록한 뒤 다시 실행하세요. 계정이 만들어지면 등록한 속성은 자동으로 삭제됩니다.'
    );
  }

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var user = {
    user_id: newId('U'),
    name: adminName || '관리자',
    email: adminEmail,
    password_hash: hashPassword(adminPassword),
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
  clearSeedProperties_(props);

  return { skipped: false, user_id: user.user_id };
}

/** 초기 관리자 정보를 담은 스크립트 속성을 지운다. 비밀번호가 설정에 남지 않게 한다. */
function clearSeedProperties_(props) {
  props.deleteProperty(SEED_EMAIL_PROPERTY);
  props.deleteProperty(SEED_PASSWORD_PROPERTY);
  props.deleteProperty(SEED_NAME_PROPERTY);
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

  // Apps Script는 스프레드시트의 마지막 남은 시트를 지우지 못한다.
  // 관리 대상 13개가 전부인 상태에서 순서대로 지우면 마지막 하나에서 예외가 나고
  // 이미 지워진 12개는 복구되지 않는다. 임시 시트를 하나 세워 두고 작업한다.
  var placeholder = spreadsheet.getSheetByName(RESET_PLACEHOLDER_NAME);
  if (!placeholder) {
    placeholder = spreadsheet.insertSheet(RESET_PLACEHOLDER_NAME);
  }

  Object.keys(SHEETS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (sheet) spreadsheet.deleteSheet(sheet);
  });

  var result = setupSheets();
  spreadsheet.deleteSheet(placeholder);
  return result;
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
    RESET_PLACEHOLDER_NAME: RESET_PLACEHOLDER_NAME,
    SEED_EMAIL_PROPERTY: SEED_EMAIL_PROPERTY,
    SEED_PASSWORD_PROPERTY: SEED_PASSWORD_PROPERTY,
    SEED_NAME_PROPERTY: SEED_NAME_PROPERTY,
    setupSheets: setupSheets,
    seedAdmin: seedAdmin,
    resetAllSheets: resetAllSheets,
  };
}

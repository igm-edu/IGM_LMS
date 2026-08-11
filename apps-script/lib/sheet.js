/**
 * Google Sheets 접근 계층.
 * 헤더 정의는 schema.js의 SHEETS를 따르며, 각 시트의 첫 열이 기본키다.
 */

var SHEET_CACHE_TTL_SEC = 300;

var cachedSpreadsheet_ = null;

function getSpreadsheet_() {
  if (cachedSpreadsheet_) return cachedSpreadsheet_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error(
      'SPREADSHEET_ID 스크립트 속성이 설정되지 않았습니다. ' +
      '프로젝트 설정 > 스크립트 속성에서 대상 스프레드시트 ID를 등록하세요.'
    );
  }
  cachedSpreadsheet_ = SpreadsheetApp.openById(id);
  return cachedSpreadsheet_;
}

/** 테스트에서 실행 경계를 흉내내기 위해 쓴다. Apps Script는 실행마다 컨텍스트가 새로 만들어진다. */
function resetSpreadsheetCache_() {
  cachedSpreadsheet_ = null;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('시트를 찾을 수 없습니다: ' + name + '. setupSheets()를 먼저 실행하세요.');
  }
  return sheet;
}

function headersOf_(name) {
  var headers = SHEETS[name];
  if (!headers) throw new Error('정의되지 않은 시트입니다: ' + name);
  return headers;
}

function rowToObject_(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] === undefined ? '' : row[i];
  }
  return obj;
}

function objectToRow_(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var value = obj[headers[i]];
    row.push(value === undefined || value === null ? '' : value);
  }
  return row;
}

/**
 * 기본키에 해당하는 행 번호를 찾는다. 없으면 0.
 * 캐시된 행 번호는 A열 값이 실제로 일치할 때만 사용한다.
 * 관리자가 시트를 직접 편집해 행이 밀렸을 수 있기 때문이다.
 */
function rowIndexOf_(name, pk) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'idx:' + name + ':' + pk;
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();

  var cached = cache.get(cacheKey);
  if (cached) {
    var cachedRow = parseInt(cached, 10);
    if (cachedRow >= 2 && cachedRow <= lastRow &&
        String(sheet.getRange(cachedRow, 1).getValue()) === pk) {
      return cachedRow;
    }
    cache.remove(cacheKey);
  }

  if (lastRow < 2) return 0;
  var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === pk) {
      var row = i + 2;
      cache.put(cacheKey, String(row), SHEET_CACHE_TTL_SEC);
      return row;
    }
  }
  return 0;
}

function readAll(name) {
  var headers = headersOf_(name);
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    out.push(rowToObject_(headers, values[i]));
  }
  return out;
}

function findByPk(name, pk) {
  var headers = headersOf_(name);
  var row = rowIndexOf_(name, String(pk));
  if (!row) return null;
  var values = getSheet_(name).getRange(row, 1, 1, headers.length).getValues()[0];
  return rowToObject_(headers, values);
}

function findBy(name, field, value) {
  var rows = readAll(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * 기본키가 아닌 열로 일치하는 레코드를 전부 찾는다.
 * readAll이 시트 전체를 읽는 것과 달리 해당 열 하나만 훑어 행 번호를 찾고
 * 일치한 행만 다시 읽는다. 호출은 여러 번이지만 각 payload가 훨씬 작다.
 *
 * normalizer를 넘기면 찾는 값과 시트 셀 양쪽에 적용한 뒤 비교한다.
 * 한쪽에만 적용하면 관리자가 시트를 손으로 편집한 행이 조회되지 않는다.
 * 이메일 조회가 바로 그런 경우다 — 저장 경로만 소문자로 맞춰봐야
 * 사람이 대문자로 적어 넣은 행은 영영 찾지 못한다.
 */
function findAllByColumn(name, field, value, normalizer) {
  var headers = headersOf_(name);
  var columnIndex = headers.indexOf(field);
  if (columnIndex === -1) {
    throw new Error('정의되지 않은 열입니다: ' + name + '.' + field);
  }

  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var column = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues();
  var target = normalizer ? String(normalizer(value)) : String(value);
  var out = [];
  for (var i = 0; i < column.length; i++) {
    var cell = normalizer ? String(normalizer(column[i][0])) : String(column[i][0]);
    if (cell === target) {
      var row = sheet.getRange(i + 2, 1, 1, headers.length).getValues()[0];
      out.push(rowToObject_(headers, row));
    }
  }
  return out;
}

/** findAllByColumn과 같되 가장 위의 한 행만 돌려준다. 없으면 null. */
function findByColumn(name, field, value, normalizer) {
  var rows = findAllByColumn(name, field, value, normalizer);
  return rows.length ? rows[0] : null;
}

function insert(name, obj) {
  var headers = headersOf_(name);
  var pk = String(obj[headers[0]] === undefined ? '' : obj[headers[0]]);
  if (!pk) {
    throw new Error('기본키가 비어 있습니다: ' + name + '.' + headers[0]);
  }
  if (rowIndexOf_(name, pk)) {
    throw new Error('이미 존재하는 기본키입니다: ' + name + '.' + headers[0] + ' = ' + pk);
  }
  getSheet_(name).appendRow(objectToRow_(headers, obj));
  return obj;
}

function update(name, pk, patch) {
  var headers = headersOf_(name);
  var key = String(pk);
  var row = rowIndexOf_(name, key);
  if (!row) return null;

  var sheet = getSheet_(name);
  var current = rowToObject_(headers, sheet.getRange(row, 1, 1, headers.length).getValues()[0]);
  for (var field in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      current[field] = patch[field];
    }
  }
  current[headers[0]] = key;

  sheet.getRange(row, 1, 1, headers.length).setValues([objectToRow_(headers, current)]);
  return current;
}

function upsert(name, obj) {
  var headers = headersOf_(name);
  var pk = String(obj[headers[0]]);
  return findByPk(name, pk) ? update(name, pk, obj) : insert(name, obj);
}

function deleteByPk(name, pk) {
  var key = String(pk);
  var row = rowIndexOf_(name, key);
  if (!row) return false;
  getSheet_(name).deleteRow(row);
  CacheService.getScriptCache().remove('idx:' + name + ':' + key);
  return true;
}

function newId(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

if (typeof module !== 'undefined') {
  global.SHEETS = require('../schema').SHEETS;
  module.exports = {
    readAll: readAll,
    findByPk: findByPk,
    findBy: findBy,
    findByColumn: findByColumn,
    findAllByColumn: findAllByColumn,
    insert: insert,
    update: update,
    upsert: upsert,
    deleteByPk: deleteByPk,
    newId: newId,
    getSheet_: getSheet_,
    getSpreadsheet_: getSpreadsheet_,
    resetSpreadsheetCache_: resetSpreadsheetCache_,
  };
}

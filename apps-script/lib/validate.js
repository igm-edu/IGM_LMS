/**
 * 순수 검증 로직. Sheets나 Apps Script API에 의존하지 않는다.
 */

var PASSWORD_MIN_LENGTH = 8;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 이메일을 저장·조회에 쓸 표준형으로 바꾼다.
 * 정규화하지 않으면 Hong@igm.co.kr로 가입한 사람이 소문자로 로그인할 때 실패하고,
 * 중복 검사가 대소문자만 다른 주소를 다른 것으로 판정해 계정이 둘 생긴다.
 */
function normalizeEmail(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

/** 통과하면 null, 아니면 사용자에게 보여줄 사유 문자열을 돌려준다. */
function validatePassword(value) {
  var password = value === undefined || value === null ? '' : String(value);
  if (password.length < PASSWORD_MIN_LENGTH) {
    return '비밀번호는 ' + PASSWORD_MIN_LENGTH + '자 이상이어야 합니다.';
  }
  if (!/[A-Za-z]/.test(password)) {
    return '비밀번호에 영문자를 포함해야 합니다.';
  }
  if (!/[0-9]/.test(password)) {
    return '비밀번호에 숫자를 포함해야 합니다.';
  }
  return null;
}

/** 비어 있는 필수 항목의 이름 목록을 돌려준다. */
function requireFields(payload, fields) {
  var missing = [];
  var source = payload || {};
  for (var i = 0; i < fields.length; i++) {
    var value = source[fields[i]];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(fields[i]);
    }
  }
  return missing;
}

var CLASS_STATUSES = ['모집중', '진행중', '종료'];

/**
 * 영상 주소는 https만 받는다. 사이트가 GitHub Pages(HTTPS)라
 * http 영상은 브라우저가 혼합 콘텐츠로 차단한다. 등록 시점에 막지 않으면
 * 수강생이 재생 버튼을 눌러야 비로소 드러난다.
 */
function isHttpsUrl(value) {
  if (value === undefined || value === null) return false;
  return /^https:\/\/\S+$/.test(String(value).trim());
}

/**
 * 출결 기준과 퀴즈 합격점은 0~100이어야 한다. 범위를 보지 않으면 120 같은 값이
 * 들어가 아무도 수료할 수 없는 클래스가 오류 없이 만들어진다.
 * 폼과 시트에서 문자열로 오므로 문자열 숫자도 허용한다.
 */
function isPercentInRange(value) {
  if (value === undefined || value === null) return false;
  if (String(value).trim() === '') return false;
  var num = Number(value);
  return !isNaN(num) && num >= 0 && num <= 100;
}

function isValidClassStatus(value) {
  return CLASS_STATUSES.indexOf(String(value)) !== -1;
}

/** 둘 중 하나라도 비어 있으면 통과로 본다. 기간 미정으로 클래스를 먼저 열 수 있다. */
function isValidDateRange(start, end) {
  if (!start || !end) return true;
  var from = new Date(start).getTime();
  var to = new Date(end).getTime();
  if (isNaN(from) || isNaN(to)) return false;
  return from <= to;
}

/** 기존 차시 목록에서 다음 순서 번호를 구한다. 값이 깨진 항목은 건너뛴다. */
function nextLessonOrder(lessons) {
  var max = 0;
  for (var i = 0; i < lessons.length; i++) {
    var order = Number(lessons[i].lesson_order);
    if (!isNaN(order) && order > max) max = order;
  }
  return max + 1;
}

if (typeof module !== 'undefined') {
  module.exports = {
    PASSWORD_MIN_LENGTH: PASSWORD_MIN_LENGTH,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    validatePassword: validatePassword,
    requireFields: requireFields,
    CLASS_STATUSES: CLASS_STATUSES,
    isHttpsUrl: isHttpsUrl,
    isPercentInRange: isPercentInRange,
    isValidClassStatus: isValidClassStatus,
    isValidDateRange: isValidDateRange,
    nextLessonOrder: nextLessonOrder,
  };
}

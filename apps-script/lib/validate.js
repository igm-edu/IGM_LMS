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

if (typeof module !== 'undefined') {
  module.exports = {
    PASSWORD_MIN_LENGTH: PASSWORD_MIN_LENGTH,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    validatePassword: validatePassword,
    requireFields: requireFields,
  };
}

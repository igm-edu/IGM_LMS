/**
 * 예상된 실패와 예기치 못한 예외를 구분하기 위한 오류 타입.
 * appCode가 붙은 예외는 사용자에게 그대로 전달되고 ErrorLog에 기록하지 않는다.
 * 그 외 예외만 ErrorLog에 남긴다. 구분하지 않으면 정상적인 로그인 실패가
 * 로그를 채워 진짜 버그를 묻어버린다.
 */
var ERROR_CODES = {
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
};

function appError_(code, message) {
  var err = new Error(message);
  err.appCode = code;
  return err;
}

function isAppError_(err) {
  return !!(err && err.appCode);
}

if (typeof module !== 'undefined') {
  module.exports = {
    ERROR_CODES: ERROR_CODES,
    appError_: appError_,
    isAppError_: isAppError_,
  };
}

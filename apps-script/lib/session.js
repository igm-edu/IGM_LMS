/**
 * 세션 토큰 발급과 검증.
 * 원문은 브라우저에만 주고 시트에는 해시만 저장한다. 스프레드시트가 유출되어도
 * 그 값으로 바로 로그인할 수 없게 하기 위해서다.
 */

var SESSION_HOURS = 24;
var SESSION_RENEW_WITHIN_HOURS = 6;

/**
 * 만료 상태를 판정한다. 시각을 인자로 받는 순수 함수라 경계값을 직접 검증할 수 있다.
 * 'expired' 만료됨 / 'renew' 유효하지만 연장 필요 / 'valid' 유효
 */
function sessionStatus_(expiresAt, now) {
  var expiry = new Date(expiresAt).getTime();
  var current = now.getTime();
  if (!expiry || current >= expiry) return 'expired';
  if (expiry - current <= SESSION_RENEW_WITHIN_HOURS * 3600 * 1000) return 'renew';
  return 'valid';
}

function issueSession(userId, now) {
  var issuedAt = now || new Date();
  var token = generateToken();
  insert('Sessions', {
    token_hash: sha256Hex(token),
    user_id: userId,
    created_at: issuedAt,
    expires_at: new Date(issuedAt.getTime() + SESSION_HOURS * 3600 * 1000),
  });
  return token;
}

/**
 * 토큰을 검증하고 사용자 레코드를 돌려준다.
 * 연장은 만료 6시간 이내일 때만 일어난다. 한 번 연장하면 남은 시간이 다시
 * 24시간이 되므로 이후 18시간 동안 연장 조건에 걸리지 않는다. 별도 장치 없이
 * 시트 쓰기가 자연히 제한된다.
 */
function verifySession(token, now) {
  var current = now || new Date();
  if (!token) throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');

  var hash = sha256Hex(token);
  var record = findByPk('Sessions', hash);
  if (!record) throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');

  if (sessionStatus_(record.expires_at, current) === 'expired') {
    deleteByPk('Sessions', hash);
    throw appError_('TOKEN_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }

  var user = findByPk('Users', record.user_id);
  if (!user) {
    deleteByPk('Sessions', hash);
    throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');
  }
  if (String(user.status) !== 'active') {
    throw appError_('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  }

  if (sessionStatus_(record.expires_at, current) === 'renew') {
    update('Sessions', hash, {
      expires_at: new Date(current.getTime() + SESSION_HOURS * 3600 * 1000),
    });
  }

  return user;
}

function revokeSession(token) {
  if (!token) return false;
  return deleteByPk('Sessions', sha256Hex(token));
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./sheet');
  var hashLib = require('./hash');
  global.insert = sheetLib.insert;
  global.findByPk = sheetLib.findByPk;
  global.update = sheetLib.update;
  global.deleteByPk = sheetLib.deleteByPk;
  global.generateToken = hashLib.generateToken;
  global.sha256Hex = hashLib.sha256Hex;
  global.appError_ = require('./errors').appError_;

  module.exports = {
    SESSION_HOURS: SESSION_HOURS,
    SESSION_RENEW_WITHIN_HOURS: SESSION_RENEW_WITHIN_HOURS,
    sessionStatus_: sessionStatus_,
    issueSession: issueSession,
    verifySession: verifySession,
    revokeSession: revokeSession,
  };
}

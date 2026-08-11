/**
 * 인증 핸들러. 라우팅은 main.js가 담당하고 여기서는 각 기능의 내용만 다룬다.
 */

/**
 * 응답에 내보낼 필드 목록. 화이트리스트로 관리한다.
 * 시트에 열이 추가되어도 자동으로 새어나가지 않게 하기 위해서다.
 * password_hash는 물론이고 birth_date(수료증 발급 전용)와 동의 기록도 내보내지 않는다.
 */
var PUBLIC_USER_FIELDS = [
  'user_id', 'name', 'email', 'phone', 'company', 'position',
  'role', 'status', 'created_at',
];

function publicUser_(user) {
  var out = {};
  for (var i = 0; i < PUBLIC_USER_FIELDS.length; i++) {
    var field = PUBLIC_USER_FIELDS[i];
    if (user[field] !== undefined) out[field] = user[field];
  }
  return out;
}

var SIGNUP_REQUIRED_FIELDS = [
  'name', 'email', 'password', 'phone', 'company', 'position', 'birth_date',
];

function handleSignup(payload) {
  var missing = requireFields(payload, SIGNUP_REQUIRED_FIELDS);
  if (missing.length) {
    throw appError_('BAD_REQUEST', '필수 항목이 비어 있습니다: ' + missing.join(', '));
  }
  if (payload.consent !== true) {
    throw appError_('BAD_REQUEST', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
  }

  var email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    throw appError_('BAD_REQUEST', '이메일 형식이 올바르지 않습니다.');
  }

  var passwordError = validatePassword(payload.password);
  if (passwordError) {
    throw appError_('BAD_REQUEST', passwordError);
  }

  // 해싱은 약 1.4초가 걸린다. 잠금을 잡은 채로 해싱까지 하면 가입 폭주가
  // 몰리는 바로 그 순간에 모든 요청이 직렬화된다. 잠금 밖에서 먼저 끝낸다.
  var passwordHash = hashPassword(payload.password);

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockError) {
    throw appError_('BAD_REQUEST', '요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.');
  }

  var user;
  try {
    // 확인과 저장 사이에 다른 요청이 끼어들면 같은 이메일로 계정이 둘 생긴다.
    // 시트 값도 정규화해서 본다. 그러지 않으면 사람이 손으로 넣은 Kim@IGM.co.kr을
    // kim@igm.co.kr 가입이 중복으로 잡지 못해 한 사람에게 행이 둘 생긴다.
    if (findByColumn('Users', 'email', email, normalizeEmail)) {
      throw appError_('EMAIL_TAKEN', '이미 가입된 이메일입니다.');
    }
    user = {
      user_id: newId('U'),
      name: String(payload.name).trim(),
      email: email,
      password_hash: passwordHash,
      phone: String(payload.phone).trim(),
      company: String(payload.company).trim(),
      position: String(payload.position).trim(),
      birth_date: String(payload.birth_date).trim(),
      role: 'student',
      status: 'active',
      consent_at: now,
      retention_until: retention,
      created_at: now,
    };
    insert('Users', user);
  } finally {
    lock.releaseLock();
  }

  // 별도 승인 절차가 없으므로 가입 직후 바로 로그인 상태로 넘긴다.
  var token = issueSession(user.user_id, now);
  return { token: token, user: publicUser_(user) };
}

function handleLogin(payload) {
  var email = normalizeEmail(payload.email);
  var password = payload.password;
  if (!email || !password) {
    throw appError_('BAD_REQUEST', '이메일과 비밀번호를 입력해 주세요.');
  }

  // 잠긴 계정은 비밀번호를 검증하지 않고 즉시 거부하며 카운터도 늘리지 않는다.
  // 늘리면 공격자가 요청을 계속 보내는 것만으로 잠금을 무한히 연장할 수 있다.
  if (isLocked(email)) {
    throw appError_('ACCOUNT_LOCKED', '로그인 시도가 많아 잠시 잠겼습니다. 10분 후 다시 시도해 주세요.');
  }

  // 같은 이메일 행이 둘 이상일 수 있다. 중복 검사가 정규화 없이 돌던 시절에
  // 만들어진 행들이다. 첫 행만 보면 나머지 사람은 비밀번호가 맞아도 영영
  // 로그인하지 못하므로, 일치하는 행을 모두 시도한다.
  var candidates = findAllByColumn('Users', 'email', email, normalizeEmail);
  if (candidates.length > 1) {
    // 관리자가 찾아서 정리해야 할 상태다. 로그인 자체는 막지 않고 기록만 남긴다.
    logError_('auth.login', '', new Error(
      '같은 이메일의 사용자 행이 ' + candidates.length + '개입니다: ' + email
    ));
  }

  var user = null;
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    try {
      if (verifyPassword(password, candidate.password_hash)) {
        user = candidate;
        break;
      }
    } catch (err) {
      // 저장값이 손상되어도 로그인 기능 전체가 죽어서는 안 된다.
      // 그 계정만 건너뛰고 원인 파악을 위해 기록은 남긴다.
      logError_('auth.login', candidate.user_id, err);
    }
  }

  // 이메일이 없는 경우와 비밀번호가 틀린 경우를 구분해 알려주면
  // 어떤 이메일이 가입돼 있는지 확인하는 수단이 된다. 같은 응답을 준다.
  if (!user) {
    recordFailure(email);
    throw appError_('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  if (String(user.status) !== 'active') {
    throw appError_('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  }

  clearFailures(email);
  return { token: issueSession(user.user_id), user: publicUser_(user) };
}

/**
 * 본인이 고칠 수 있는 필드. 화이트리스트로 관리한다.
 * email은 로그인 ID라 중복 검사와 세션 처리가 함께 필요하고, role과 status는
 * 관리자 권한이며, password_hash는 비밀번호 변경 기능이 따로 있어야 한다.
 */
var EDITABLE_PROFILE_FIELDS = ['name', 'phone', 'company', 'position', 'birth_date'];

function handleMe(payload, user) {
  return publicUser_(user);
}

function handleUpdateProfile(payload, user) {
  var patch = {};
  var blanked = [];

  for (var i = 0; i < EDITABLE_PROFILE_FIELDS.length; i++) {
    var field = EDITABLE_PROFILE_FIELDS[i];
    // 아예 보내지 않은 항목은 건드리지 않는다. 부분 수정을 지원하기 위해서다.
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;

    var value = payload[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      // 보내긴 했는데 비어 있다면 "지우겠다"는 뜻이다. 다섯 항목 모두 가입 시
      // 필수라 비울 수 없으므로, 조용히 무시하는 대신 그렇다고 알려준다.
      blanked.push(field);
      continue;
    }
    patch[field] = String(value).trim();
  }

  if (blanked.length) {
    throw appError_('BAD_REQUEST', '비울 수 없는 항목입니다: ' + blanked.join(', '));
  }

  // 대상은 언제나 토큰에서 확인한 사용자다. payload.user_id는 쓰지 않는다.
  // 받아서 쓰면 남의 계정을 고치는 통로가 된다.
  var updated = update('Users', user.user_id, patch);
  return publicUser_(updated);
}

function handleLogout(payload, user) {
  revokeSession(payload._token);
  return { ok: true };
}

if (typeof module !== 'undefined') {
  var sheetLib = require('../lib/sheet');
  var validateLib = require('../lib/validate');
  global.appError_ = require('../lib/errors').appError_;
  global.normalizeEmail = validateLib.normalizeEmail;
  global.isValidEmail = validateLib.isValidEmail;
  global.validatePassword = validateLib.validatePassword;
  global.requireFields = validateLib.requireFields;
  global.findByColumn = sheetLib.findByColumn;
  global.findAllByColumn = sheetLib.findAllByColumn;
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.hashPassword = require('../lib/hash').hashPassword;
  global.issueSession = require('../lib/session').issueSession;
  global.RETENTION_YEARS = require('../setup').RETENTION_YEARS;
  var ratelimitLib = require('../lib/ratelimit');
  global.isLocked = ratelimitLib.isLocked;
  global.recordFailure = ratelimitLib.recordFailure;
  global.clearFailures = ratelimitLib.clearFailures;
  global.verifyPassword = require('../lib/hash').verifyPassword;
  if (typeof global.logError_ !== 'function') {
    global.logError_ = function () {};
  }
  global.update = sheetLib.update;
  global.revokeSession = require('../lib/session').revokeSession;
  // LockService는 Apps Script 런타임의 전역이다. Node에서는 테스트 셰임이
  // installGlobals()로 미리 채워 넣지 않는 한 존재하지 않으므로, 여기서는
  // 아무 것도 하지 않는 대체 구현으로 채워 코드가 죽지 않게만 한다.
  if (typeof global.LockService === 'undefined') {
    global.LockService = {
      getScriptLock: function () {
        return { waitLock: function () {}, releaseLock: function () {} };
      },
    };
  }

  module.exports = {
    PUBLIC_USER_FIELDS: PUBLIC_USER_FIELDS,
    EDITABLE_PROFILE_FIELDS: EDITABLE_PROFILE_FIELDS,
    publicUser_: publicUser_,
    handleSignup: handleSignup,
    handleLogin: handleLogin,
    handleMe: handleMe,
    handleUpdateProfile: handleUpdateProfile,
    handleLogout: handleLogout,
  };
}

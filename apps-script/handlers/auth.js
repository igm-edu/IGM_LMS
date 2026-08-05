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

  if (findByColumn('Users', 'email', email)) {
    throw appError_('EMAIL_TAKEN', '이미 가입된 이메일입니다.');
  }

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var user = {
    user_id: newId('U'),
    name: String(payload.name).trim(),
    email: email,
    password_hash: hashPassword(payload.password),
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

  // 별도 승인 절차가 없으므로 가입 직후 바로 로그인 상태로 넘긴다.
  var token = issueSession(user.user_id, now);
  return { token: token, user: publicUser_(user) };
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
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.hashPassword = require('../lib/hash').hashPassword;
  global.issueSession = require('../lib/session').issueSession;
  global.RETENTION_YEARS = require('../setup').RETENTION_YEARS;

  module.exports = {
    PUBLIC_USER_FIELDS: PUBLIC_USER_FIELDS,
    publicUser_: publicUser_,
    handleSignup: handleSignup,
  };
}

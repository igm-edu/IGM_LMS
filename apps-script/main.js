/**
 * 웹앱 진입점. 요청은 단일 엔드포인트로 POST되고 본문의 action으로 갈라진다.
 *
 * 중요: Apps Script 웹앱은 CORS 사전 요청(preflight)에 응답할 수 없다.
 * 프론트는 Content-Type을 text/plain으로 보내 사전 요청 자체가 생기지 않게 해야 하며,
 * 그래서 세션 토큰도 헤더가 아니라 본문에 담는다.
 */

var PUBLIC = 'PUBLIC';
var ANY_USER = 'ANY_USER';

var routesCache_ = null;

/**
 * 라우팅 표. 함수 안에서 만드는 이유는 이름 해석 시점 때문이다.
 * 파일 최상단에서 리터럴로 만들면 Node에서 require 하는 순간 handleSignup 등이
 * 아직 선언되지 않아 ReferenceError가 난다. 함수 안에 두면 첫 호출 시점에
 * 해석되므로 Apps Script와 Node 양쪽에서 동작한다.
 */
function routes_() {
  if (!routesCache_) {
    routesCache_ = {
      'auth.signup':        { handler: handleSignup,        roles: PUBLIC },
      'auth.login':         { handler: handleLogin,         roles: PUBLIC },
      'auth.logout':        { handler: handleLogout,        roles: ANY_USER },
      'auth.me':            { handler: handleMe,            roles: ANY_USER },
      'auth.updateProfile': { handler: handleUpdateProfile, roles: ANY_USER },
    };
  }
  return routesCache_;
}

function doGet() {
  return jsonOutput_({ ok: true, data: { service: 'IGM LMS API', status: 'ok' } });
}

function doPost(e) {
  var action = '';
  var userId = '';

  try {
    var request = parseRequest_(e);
    action = request.action;

    var route = routes_()[action];
    if (!route) {
      throw appError_('UNKNOWN_ACTION', '알 수 없는 요청입니다.');
    }

    var user = null;
    if (route.roles !== PUBLIC) {
      user = verifySession(request.token);
      userId = user.user_id;
      if (route.roles !== ANY_USER && route.roles.indexOf(String(user.role)) === -1) {
        throw appError_('FORBIDDEN', '권한이 없습니다.');
      }
    }

    // 로그아웃은 요청에 실린 토큰 자체가 필요하다. 핸들러가 토큰을 다시 파싱하지
    // 않도록 payload에 실어 전달한다.
    var payload = request.payload;
    payload._token = request.token;

    return jsonOutput_({ ok: true, data: route.handler(payload, user) });
  } catch (err) {
    if (isAppError_(err)) {
      return jsonOutput_({ ok: false, error: { code: err.appCode, message: err.message } });
    }
    logError_(action, userId, err);
    return jsonOutput_({
      ok: false,
      error: { code: 'INTERNAL', message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
    });
  }
}

function parseRequest_(e) {
  var body = e && e.postData ? e.postData.contents : '';
  var parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch (err) {
    // 본문이 깨진 것은 클라이언트 문제다. ErrorLog를 채울 이유가 없다.
    throw appError_('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
  return {
    action: String(parsed.action || ''),
    token: parsed.token || '',
    payload: parsed.payload || {},
  };
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 예기치 못한 예외만 남긴다. 로깅이 실패해도 원래 오류를 덮지 않는다. */
function logError_(action, userId, err) {
  try {
    insert('ErrorLog', {
      log_id: newId('E'),
      occurred_at: new Date(),
      action: action || '',
      user_id: userId || '',
      message: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : '',
    });
  } catch (ignored) {
    // 무시한다
  }
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./lib/sheet');
  var errorsLib = require('./lib/errors');
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.appError_ = errorsLib.appError_;
  global.isAppError_ = errorsLib.isAppError_;
  global.logError_ = logError_;
  global.verifySession = require('./lib/session').verifySession;

  var authHandlers = require('./handlers/auth');
  global.handleSignup = authHandlers.handleSignup;
  global.handleLogin = authHandlers.handleLogin;
  global.handleLogout = authHandlers.handleLogout;
  global.handleMe = authHandlers.handleMe;
  global.handleUpdateProfile = authHandlers.handleUpdateProfile;

  module.exports = {
    PUBLIC: PUBLIC,
    ANY_USER: ANY_USER,
    routes_: routes_,
    doGet: doGet,
    doPost: doPost,
    logError_: logError_,
  };
}

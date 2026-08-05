/**
 * 로그인 시도 제한. Apps Script는 접속자 IP를 알 수 없어 계정 기준으로만 센다.
 * 카운터는 CacheService에 두며 잠금 시간과 같은 만료를 준다.
 */

var LOGIN_MAX_FAILURES = 5;
var LOGIN_LOCK_SECONDS = 600;

function failureKey_(key) {
  return 'loginfail:' + key;
}

function isLocked(key) {
  var raw = CacheService.getScriptCache().get(failureKey_(key));
  if (raw === null) return false;
  return parseInt(raw, 10) >= LOGIN_MAX_FAILURES;
}

function recordFailure(key) {
  var cache = CacheService.getScriptCache();
  var cacheKey = failureKey_(key);
  var raw = cache.get(cacheKey);
  var count = (raw === null ? 0 : parseInt(raw, 10)) + 1;
  cache.put(cacheKey, String(count), LOGIN_LOCK_SECONDS);
  return count;
}

function clearFailures(key) {
  CacheService.getScriptCache().remove(failureKey_(key));
}

if (typeof module !== 'undefined') {
  module.exports = {
    LOGIN_MAX_FAILURES: LOGIN_MAX_FAILURES,
    LOGIN_LOCK_SECONDS: LOGIN_LOCK_SECONDS,
    isLocked: isLocked,
    recordFailure: recordFailure,
    clearFailures: clearFailures,
  };
}

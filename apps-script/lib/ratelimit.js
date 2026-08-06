/**
 * 로그인 시도 제한. Apps Script는 접속자 IP를 알 수 없어 계정 기준으로만 센다.
 * 카운터는 CacheService에 두며 잠금 시간과 같은 만료를 준다.
 */

var LOGIN_MAX_FAILURES = 5;

/**
 * 잠금 단계. 5회 실패마다 다음 단계로 넘어가며 마지막 값에서 멈춘다.
 * 평탄한 10분 잠금은 10분마다 5회의 유료(해싱 포함) 시도를 하루 종일
 * 허용해, 유효한 이메일 몇 개만으로 하루 실행시간 예산을 소진시킬 수 있었다.
 * Apps Script의 CacheService는 만료를 최대 6시간까지만 받으므로 그 이상은 두지 않는다.
 */
var LOGIN_LOCK_STEPS_SECONDS = [600, 3600, 21600];
var FAILURE_MEMORY_SECONDS = 21600;

function failureKey_(key) {
  return 'loginfail:' + key;
}

function lockKey_(key) {
  return 'loginlock:' + key;
}

function isLocked(key) {
  return CacheService.getScriptCache().get(lockKey_(key)) !== null;
}

function lockSecondsFor_(failureCount) {
  var step = Math.floor(failureCount / LOGIN_MAX_FAILURES) - 1;
  if (step < 0) step = 0;
  if (step >= LOGIN_LOCK_STEPS_SECONDS.length) {
    step = LOGIN_LOCK_STEPS_SECONDS.length - 1;
  }
  return LOGIN_LOCK_STEPS_SECONDS[step];
}

function recordFailure(key) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(failureKey_(key));
  var count = (raw === null ? 0 : parseInt(raw, 10));
  if (!(count >= 0)) count = 0;
  count += 1;

  // 실패 누적은 잠금보다 오래 기억해야 다음 잠금을 더 길게 줄 수 있다.
  cache.put(failureKey_(key), String(count), FAILURE_MEMORY_SECONDS);

  if (count % LOGIN_MAX_FAILURES === 0) {
    cache.put(lockKey_(key), '1', lockSecondsFor_(count));
  }
  return count;
}

function clearFailures(key) {
  var cache = CacheService.getScriptCache();
  cache.remove(failureKey_(key));
  cache.remove(lockKey_(key));
}

if (typeof module !== 'undefined') {
  module.exports = {
    LOGIN_MAX_FAILURES: LOGIN_MAX_FAILURES,
    LOGIN_LOCK_STEPS_SECONDS: LOGIN_LOCK_STEPS_SECONDS,
    lockSecondsFor_: lockSecondsFor_,
    isLocked: isLocked,
    recordFailure: recordFailure,
    clearFailures: clearFailures,
  };
}

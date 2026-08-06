import { API_URL } from './config.js';

/** config.js를 아직 채우지 않았을 때의 값. */
export const UNSET_API_URL = '__WEB_APP_URL__';

let apiUrl = API_URL;
let retryDelays = [400, 1200];

/** 배포 주소를 바꾼다. 테스트와 로컬 확인용. */
export function setApiUrl(url) {
  apiUrl = url;
}

/** 재시도 간격을 바꾼다. 테스트가 기다리지 않게 하려고 둔다. */
export function setRetryDelays(delays) {
  retryDelays = delays;
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * 서버에 요청을 보내고 응답의 data를 돌려준다.
 *
 * Apps Script 웹앱은 CORS 사전 요청에 응답할 수 없다. 그래서 Content-Type을
 * text/plain으로 두어 사전 요청이 아예 생기지 않게 하고, 토큰도 헤더가 아니라
 * 본문에 담는다. 헤더를 하나라도 더 붙이면 통신이 통째로 실패한다.
 */
export async function call(action, payload, token) {
  if (apiUrl === UNSET_API_URL) {
    throw new ApiError('CONFIG', '웹앱 주소가 설정되지 않았습니다. assets/js/config.js를 확인하세요.');
  }

  const body = JSON.stringify({
    action: action,
    token: token || '',
    payload: payload || {},
  });

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]);

    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
      });
    } catch (networkError) {
      continue; // 네트워크 오류만 재시도한다
    }

    let parsed;
    try {
      parsed = JSON.parse(await response.text());
    } catch (parseError) {
      // 서버가 JSON이 아닌 것을 돌려준 경우다. 대개 배포 설정이 잘못돼
      // 구글 로그인 페이지가 오는 상황이라 재시도해도 소용없다.
      throw new ApiError('BAD_RESPONSE', '서버 응답을 이해할 수 없습니다. 배포 설정을 확인해 주세요.');
    }

    if (parsed && parsed.ok) return parsed.data;

    const error = (parsed && parsed.error) || {};
    throw new ApiError(error.code || 'INTERNAL', error.message || '오류가 발생했습니다.');
  }

  throw new ApiError('NETWORK', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
}

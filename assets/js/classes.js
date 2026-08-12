import { ApiError, rest, rpc } from './api.js';

/**
 * 클래스·차시 데이터 계층.
 *
 * 검증을 클라이언트에도 두는 이유는 방어가 아니라 안내다. 실제 방어는
 * DB 제약과 RLS 정책이 하고 있으며, 여기서 막는 것은 굳이 왕복하지 않아도
 * 될 입력을 미리 걸러 사용자가 무엇이 잘못됐는지 바로 알게 하기 위해서다.
 * 그래서 규칙은 001_schema.sql 의 제약과 같은 내용을 따른다.
 */

const CLASS_FIELDS =
  'id,class_name,batch,instructor_id,start_date,end_date,' +
  'watch_rate_threshold,quiz_pass_score,quiz_retry_allowed,status,created_at';

const LESSON_FIELDS = 'id,class_id,lesson_order,title,video_url,video_duration_sec';

export const CLASS_STATUSES = ['모집중', '진행중', '종료'];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isPercent(value) {
  // 숫자와 문자열만 받는다. Number(false)가 0이라 타입을 보지 않으면 불리언이
  // 통과하는데, 수료 기준이 0으로 저장되면 아무도 보지 않아도 전원 수료가 된다.
  // 이 함수가 막으려는 120%와 같은 종류의 조용한 실패다.
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (isBlank(value)) return false;
  const num = Number(value);
  return !isNaN(num) && num >= 0 && num <= 100;
}

/** 통과하면 null, 아니면 사용자에게 보여줄 사유. */
export function validateClass(fields) {
  if (isBlank(fields.class_name)) return '과정명을 입력해 주세요.';
  if (isBlank(fields.batch)) return '기수를 입력해 주세요.';
  if (!isPercent(fields.watch_rate_threshold)) return '수료 기준 시청률은 0~100 사이여야 합니다.';
  if (!isPercent(fields.quiz_pass_score)) return '퀴즈 합격 점수는 0~100 사이여야 합니다.';
  if (fields.status !== undefined && CLASS_STATUSES.indexOf(fields.status) === -1) {
    return '상태 값이 올바르지 않습니다.';
  }
  // 기간 미정으로 클래스를 먼저 열 수 있어야 하므로 둘 중 하나가 비면 통과다.
  if (!isBlank(fields.start_date) && !isBlank(fields.end_date)
      && String(fields.end_date) < String(fields.start_date)) {
    return '종료일이 시작일보다 빠릅니다.';
  }
  return null;
}

export function validateLesson(fields) {
  if (isBlank(fields.title)) return '차시 제목을 입력해 주세요.';
  if (isBlank(fields.video_url)) return '영상 주소를 입력해 주세요.';
  // 사이트가 HTTPS라 http 영상은 브라우저가 혼합 콘텐츠로 막는다. 등록 때 걸러야
  // 수강생이 재생 버튼을 누르고 나서야 알게 되는 일이 없다.
  if (!/^https:\/\/\S+$/.test(String(fields.video_url).trim())) {
    return '영상 주소는 https로 시작해야 합니다.';
  }
  const duration = Number(fields.video_duration_sec);
  if (isBlank(fields.video_duration_sec) || isNaN(duration) || duration <= 0) {
    return '영상 길이를 초 단위로 입력해 주세요.';
  }
  if (fields.lesson_order !== undefined) {
    const order = Number(fields.lesson_order);
    if (isNaN(order) || order < 1) return '차시 순서는 1 이상의 숫자여야 합니다.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 클래스
// ---------------------------------------------------------------------------

export function listClasses() {
  return rest('/classes?select=' + CLASS_FIELDS + '&order=created_at.desc');
}

export async function getClass(id) {
  const rows = await rest('/classes?select=' + CLASS_FIELDS + '&id=eq.' + id);
  return rows && rows.length ? rows[0] : null;
}

/**
 * id 를 주면 수정, 없으면 생성.
 * 수정은 fields 에 담긴 항목만 반영된다. 담기지 않은 항목은 그대로 남는다.
 * PATCH 가 본문에 있는 열만 건드리므로 별도 처리가 필요 없다.
 */
export async function saveClass(fields, id) {
  const reason = validateClass(fields);
  if (reason) throw new ApiError('BAD_REQUEST', reason);

  const rows = id
    ? await rest('/classes?select=' + CLASS_FIELDS + '&id=eq.' + id,
        { method: 'PATCH', body: fields, prefer: 'return=representation' })
    : await rest('/classes?select=' + CLASS_FIELDS,
        { method: 'POST', body: fields, prefer: 'return=representation' });

  if (!rows || !rows.length) {
    // 정책이 걸러내면 오류 없이 0건이 온다. 저장된 것처럼 보이면 안 된다.
    throw new ApiError('NOT_SAVED', '저장되지 않았습니다. 권한을 확인해 주세요.');
  }
  return rows[0];
}

/** 담당 강사 후보. profiles 는 본인 행만 보이므로 서버 함수를 거친다. */
export function listInstructors() {
  return rpc('list_instructors');
}

// ---------------------------------------------------------------------------
// 차시
// ---------------------------------------------------------------------------

export function listLessons(classId) {
  return rest('/lessons?select=' + LESSON_FIELDS
    + '&class_id=eq.' + classId + '&order=lesson_order.asc,id.asc');
}

/** 기존 차시 다음 번호. 비어 있으면 1. */
export function nextLessonOrder(lessons) {
  let max = 0;
  (lessons || []).forEach(function (lesson) {
    const order = Number(lesson.lesson_order);
    if (!isNaN(order) && order > max) max = order;
  });
  return max + 1;
}

export async function saveLesson(fields, id) {
  const reason = validateLesson(fields);
  if (reason) throw new ApiError('BAD_REQUEST', reason);

  const rows = id
    ? await rest('/lessons?select=' + LESSON_FIELDS + '&id=eq.' + id,
        { method: 'PATCH', body: fields, prefer: 'return=representation' })
    : await rest('/lessons?select=' + LESSON_FIELDS,
        { method: 'POST', body: fields, prefer: 'return=representation' });

  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '저장되지 않았습니다. 권한을 확인해 주세요.');
  }
  return rows[0];
}

/**
 * 시청 기록이 있는 차시는 DB 가 외래키로 거부한다(23503).
 * 그 경우 왜 안 되는지 알 수 있는 말로 바꿔 준다.
 */
export async function deleteLesson(id) {
  try {
    await rest('/lessons?id=eq.' + id, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiError && err.code === '23503') {
      throw new ApiError('IN_USE', '이미 시청 기록이 있어 삭제할 수 없습니다.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 영상 길이 자동 측정
// ---------------------------------------------------------------------------

/**
 * 주소를 넣으면 브라우저가 메타데이터만 받아 길이를 재고 초 단위로 돌려준다.
 * 서버가 범위 요청을 지원하지 않거나 CORS 를 막으면 실패하므로, 화면에서는
 * 실패했을 때 직접 입력할 수 있어야 한다.
 *
 * createElement 를 주입받는 이유는 이 함수가 유일하게 DOM 에 의존하기 때문이다.
 * 테스트에서 가짜 element 를 넣어 성공·실패·시간초과를 모두 확인한다.
 */
export function measureVideoDuration(url, options) {
  const opts = options || {};
  const create = opts.createElement || function () { return document.createElement('video'); };
  const timeoutMs = opts.timeoutMs === undefined ? 15000 : opts.timeoutMs;

  return new Promise(function (resolve, reject) {
    const video = create();
    let settled = false;

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 계속 받아오지 않도록 끊는다. 큰 파일이면 배경에서 계속 내려받는다.
      try { video.src = ''; } catch (err) { /* 가짜 element 는 무시 */ }
      action();
    }

    const timer = setTimeout(function () {
      finish(function () {
        reject(new ApiError('MEASURE_TIMEOUT', '영상 길이를 읽지 못했습니다. 직접 입력해 주세요.'));
      });
    }, timeoutMs);

    video.addEventListener('loadedmetadata', function () {
      const seconds = Number(video.duration);
      // 스트리밍 형식이면 Infinity 가 온다. 그대로 저장하면 시청률이 늘 0이 된다.
      if (!isFinite(seconds) || seconds <= 0) {
        finish(function () {
          reject(new ApiError('MEASURE_FAILED', '영상 길이를 읽지 못했습니다. 직접 입력해 주세요.'));
        });
        return;
      }
      finish(function () { resolve(Math.round(seconds)); });
    });

    video.addEventListener('error', function () {
      finish(function () {
        reject(new ApiError('MEASURE_FAILED', '영상을 불러오지 못했습니다. 주소를 확인하거나 길이를 직접 입력해 주세요.'));
      });
    });

    video.preload = 'metadata';
    video.src = url;
  });
}

/** 초를 사람이 읽는 형태로. 화면과 테스트가 함께 쓴다. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + '분 ' + (s < 10 ? '0' : '') + s + '초';
}

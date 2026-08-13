import { ApiError, rest, getSession } from './api.js';

/**
 * 수강생 쪽 조회와 시청 기록 저장.
 *
 * 여기서 보내는 것은 "몇 초까지 봤는가" 하나뿐이다. 시청률과 완료 여부는
 * 서버 트리거가 계산한다(002). 비율을 클라이언트가 보내면 0초에 100%를
 * 보낼 수 있기 때문이다. 누적값이 줄지 않는 것도 트리거가 지킨다.
 */

const CLASS_FIELDS = 'id,class_name,batch,status,start_date,end_date,watch_rate_threshold';
const LESSON_FIELDS = 'id,lesson_order,title,video_url,video_duration_sec';

/** 내가 수강 중인 클래스. */
export async function myClasses() {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');

  const rows = await rest('/enrollments?select=classes(' + CLASS_FIELDS + ')'
    + '&user_id=eq.' + session.user_id
    + '&status=eq.' + encodeURIComponent('수강중'));

  // 조인 결과에서 클래스만 꺼낸다. 정책이 막으면 classes 가 null 로 온다.
  return (rows || [])
    .map(function (row) { return row.classes; })
    .filter(Boolean);
}

/**
 * 클래스의 차시와 내 시청 기록.
 * watch_logs 는 정책이 본인 행만 내주므로 0개 아니면 1개다.
 */
export function myLessons(classId) {
  return rest('/lessons?select=' + LESSON_FIELDS
    + ',watch_logs(max_watched_sec,watch_rate,completed)'
    + '&class_id=eq.' + classId
    + '&order=lesson_order.asc,id.asc');
}

/** 조인된 시청 기록을 꺼낸다. 없으면 0으로 시작한 것으로 본다. */
export function progressOf(lesson) {
  const logs = lesson && lesson.watch_logs;
  const log = Array.isArray(logs) ? logs[0] : logs;
  return {
    max_watched_sec: log ? Number(log.max_watched_sec) || 0 : 0,
    watch_rate: log ? Number(log.watch_rate) || 0 : 0,
    completed: log ? !!log.completed : false,
  };
}

/**
 * 시청 위치를 저장한다.
 *
 * (user_id, lesson_id) 유니크 제약 위에서 upsert 한다. 먼저 조회해 보고
 * 없으면 넣는 방식이면 같은 영상을 두 탭에서 열었을 때 둘 다 "없음"을 보고
 * 각자 insert 를 시도한다. 서버에 한 번만 물어 충돌을 서버가 처리하게 한다.
 */
export async function saveProgress(lessonId, seconds) {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');

  const watched = Math.max(0, Math.floor(Number(seconds) || 0));
  const rows = await rest('/watch_logs?on_conflict=user_id,lesson_id'
    + '&select=max_watched_sec,watch_rate,completed', {
      method: 'POST',
      body: { user_id: session.user_id, lesson_id: lessonId, max_watched_sec: watched },
      prefer: 'resolution=merge-duplicates,return=representation',
    });

  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '시청 기록이 저장되지 않았습니다.');
  }
  return rows[0];
}

/**
 * 저장 시점을 정한다.
 *
 * 재생 중 매 초 보내면 한 사람이 한 시간짜리 영상을 보는 동안 3,600번을
 * 쓴다. 반대로 너무 드물게 보내면 창을 닫았을 때 잃는 구간이 커진다.
 * 마지막으로 저장한 위치보다 intervalSec 이상 나아갔을 때만 보낸다.
 */
export function shouldSave(lastSavedSec, currentSec, intervalSec) {
  const step = intervalSec === undefined ? 15 : intervalSec;
  return Math.floor(currentSec) - Math.floor(lastSavedSec) >= step;
}

/** 진도 표시용 문자열. */
export function progressLabel(progress, threshold) {
  const rate = Math.round(Number(progress.watch_rate) || 0);
  if (progress.completed) return '수강 완료 · ' + rate + '%';
  if (rate === 0) return '아직 보지 않음';
  return rate + '% 시청 (기준 ' + Math.round(Number(threshold) || 0) + '%)';
}

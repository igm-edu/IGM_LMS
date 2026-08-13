import { ApiError, rest, rpc, getSession } from './api.js';

/**
 * 수료 판정 조회와 실행.
 *
 * 판정 자체는 서버 함수가 한다. attendance 는 "지금 상태" 가 아니라
 * "판정한 기록" 이라, 판정 시점의 기준값이 함께 들어 있다. 그래서 화면에서는
 * 클래스의 현재 기준이 아니라 행에 찍힌 기준을 보여줘야 한다.
 */

const ATTENDANCE_FIELDS =
  'user_id,class_id,total_watch_rate,total_quiz_score,is_completed,'
  + 'watch_rate_threshold_at_completion,quiz_pass_score_at_completion,completed_at';

/** 클래스 전원을 다시 판정하고 결과를 돌려준다. 관리자·담당 강사만. */
export function judgeClass(classId) {
  return rpc('judge_class_completions', { p_class_id: classId });
}

export async function judgeOne(userId, classId) {
  const rows = await rpc('judge_completion', { p_user_id: userId, p_class_id: classId });
  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '판정 결과를 받지 못했습니다.');
  }
  return rows[0];
}

/** 이미 내려진 판정 기록. 판정을 실행하지 않고 읽기만 한다. */
export function classAttendance(classId) {
  return rest('/attendance?select=' + ATTENDANCE_FIELDS + '&class_id=eq.' + classId);
}

export async function myAttendance(classId) {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');
  const rows = await rest('/attendance?select=' + ATTENDANCE_FIELDS
    + '&class_id=eq.' + classId + '&user_id=eq.' + session.user_id);
  return rows && rows.length ? rows[0] : null;
}

/**
 * 판정 결과 한 줄 요약.
 * 기준값은 행에 찍힌 것을 쓴다. 클래스의 현재 기준을 쓰면 이미 발급한
 * 수료증의 근거와 화면이 어긋난다.
 */
export function completionLabel(row, options) {
  if (!row) return '아직 판정하지 않았습니다.';
  const opts = options || {};
  const watch = Math.round(Number(row.total_watch_rate) || 0);
  const watchBar = Math.round(Number(row.watch_rate_threshold_at_completion) || 0);

  const parts = ['시청 ' + watch + '% (기준 ' + watchBar + '%)'];
  if (opts.hasQuiz === false) {
    // 퀴즈가 없는 클래스는 퀴즈 조건을 보지 않는다. 저장된 0 을 그대로
    // 보여주면 0점을 받은 것처럼 읽힌다.
    parts.push('퀴즈 없음');
  } else {
    const quiz = Math.round(Number(row.total_quiz_score) || 0);
    const quizBar = Math.round(Number(row.quiz_pass_score_at_completion) || 0);
    parts.push('퀴즈 ' + quiz + '점 (기준 ' + quizBar + '점)');
  }
  parts.push(row.is_completed ? '수료' : '미수료');
  return parts.join(' · ');
}

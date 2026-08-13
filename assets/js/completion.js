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

// ---------------------------------------------------------------------------
// 수료증
// ---------------------------------------------------------------------------

const CERT_FIELDS = 'certificate_no,issued_at,attendance!inner(user_id,class_id)';

/** 수료한 사람 전원에게 발급한다. 이미 받은 사람은 already=true 로 돌아온다. */
export function issueClassCertificates(classId) {
  return rpc('issue_class_certificates', { p_class_id: classId });
}

export async function issueCertificate(attendanceId) {
  const rows = await rpc('issue_certificate', { p_attendance_id: attendanceId });
  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '발급 결과를 받지 못했습니다.');
  }
  return rows[0];
}

/** 발급된 수료증 조회. 발급을 실행하지 않는다. */
export function classCertificates(classId) {
  return rest('/certificates?select=' + CERT_FIELDS + '&attendance.class_id=eq.' + classId);
}

export async function myCertificate(classId) {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');
  const rows = await rest('/certificates?select=' + CERT_FIELDS
    + '&attendance.class_id=eq.' + classId
    + '&attendance.user_id=eq.' + session.user_id);
  return rows && rows.length ? rows[0] : null;
}

/**
 * 수료증 한 장에 인쇄할 내용.
 * 이름·과정명·수료일은 정책이 허용하는 범위에서만 조인되어 온다.
 * 수강생은 자기 것만, 관리자와 담당 강사는 담당 클래스 것을 볼 수 있다.
 */
export async function certificateDetail(certificateNo) {
  const rows = await rest('/certificates?select=certificate_no,issued_at,'
    + 'attendance!inner(completed_at,profiles!inner(name),classes!inner(class_name,batch))'
    + '&certificate_no=eq.' + encodeURIComponent(certificateNo));
  return rows && rows.length ? rows[0] : null;
}

/** 발급 번호 하나를 인쇄용 값으로 편다. 조인이 막혀 비어 오면 null. */
export function certificateFields(row) {
  if (!row || !row.attendance) return null;
  const a = row.attendance;
  const person = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
  const klass = Array.isArray(a.classes) ? a.classes[0] : a.classes;
  if (!person || !klass) return null;
  return {
    certificate_no: row.certificate_no,
    name: person.name,
    class_name: klass.class_name,
    batch: klass.batch,
    completed_at: a.completed_at || row.issued_at,
  };
}

/**
 * 수료일 표기. 양식이 "June 18, 2025" 형태를 쓰고 있어 그대로 따른다.
 * 사용자의 지역 설정과 무관하게 같은 모양이 나오도록 en-US 로 고정한다.
 */
export function formatCertificateDate(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul',
  }).format(date);
}

/** 조회 결과를 user_id 로 찾아 쓸 수 있게 바꾼다. */
export function certificatesByUser(rows) {
  const map = {};
  (rows || []).forEach(function (row) {
    if (row && row.attendance && row.attendance.user_id) {
      map[row.attendance.user_id] = row;
    }
  });
  return map;
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

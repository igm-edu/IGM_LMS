import { ApiError, rest, rpc } from './api.js';

/**
 * 수강 등록.
 *
 * enrollments 에는 (user_id, class_id) 유니크 제약이 있다. 그래서 취소를
 * 행 삭제가 아니라 status 변경으로 다룬다. 지웠다가 다시 넣는 방식이면
 * 누가 언제 취소했는지가 사라지고, 재등록할 때 제약과 부딪힌다.
 */

const STUDENT_FIELDS = 'id,name,email,company,position';
const SEARCH_LIMIT = 20;

/**
 * 검색어를 PostgREST 필터에 넣을 수 있게 다듬는다.
 *
 * 쉼표와 괄호는 `or=(...)` 식의 구분자라 그대로 넣으면 조건이 달라진다.
 * SQL 주입은 아니지만 의도하지 않은 필터가 만들어지므로 미리 걷어낸다.
 * `*` 는 ilike 의 와일드카드라 사용자가 넣은 것은 뺀다.
 */
export function sanitizeSearchTerm(term) {
  return String(term === undefined || term === null ? '' : term)
    .replace(/[(),*"\\]/g, ' ')
    .trim();
}

/**
 * 수강생 후보를 찾는다. 관리자만 다른 사람의 profiles 행을 볼 수 있으므로
 * 이 함수는 관리자 화면에서만 결과가 나온다.
 * 검색어가 비면 이름순 앞부분만 돌려준다. 전체를 끌어오지 않기 위해서다.
 */
export function searchStudents(term) {
  const safe = sanitizeSearchTerm(term);
  let path = '/profiles?select=' + STUDENT_FIELDS
    + '&status=eq.active&order=name.asc&limit=' + SEARCH_LIMIT;
  if (safe) {
    const like = '*' + safe + '*';
    path += '&or=(name.ilike.' + encodeURIComponent(like)
          + ',email.ilike.' + encodeURIComponent(like) + ')';
  }
  return rest(path);
}

/** 클래스의 수강생 명단. 서버 함수가 필요한 열만 골라 돌려준다. */
export function listRoster(classId) {
  return rpc('class_roster', { cid: classId });
}

function findEnrollment(userId, classId) {
  return rest('/enrollments?select=id,status&user_id=eq.' + userId + '&class_id=eq.' + classId);
}

/**
 * 등록한다. 취소했던 사람을 다시 넣는 경우까지 여기서 다룬다.
 * 유니크 제약 때문에 두 번째 insert 는 실패하므로, 행이 있으면 상태만 되돌린다.
 */
export async function enroll(userId, classId) {
  if (!userId || !classId) {
    throw new ApiError('BAD_REQUEST', '수강생과 클래스를 지정해 주세요.');
  }

  const existing = await findEnrollment(userId, classId);
  if (existing && existing.length) {
    if (existing[0].status === '수강중') {
      throw new ApiError('ALREADY_ENROLLED', '이미 등록된 수강생입니다.');
    }
    const rows = await rest('/enrollments?select=id,status&id=eq.' + existing[0].id,
      { method: 'PATCH', body: { status: '수강중' }, prefer: 'return=representation' });
    if (!rows || !rows.length) {
      throw new ApiError('NOT_SAVED', '등록되지 않았습니다. 권한을 확인해 주세요.');
    }
    return rows[0];
  }

  const rows = await rest('/enrollments?select=id,status',
    { method: 'POST', body: { user_id: userId, class_id: classId }, prefer: 'return=representation' });
  if (!rows || !rows.length) {
    // 정책이 걸러내면 오류 없이 0건이 온다. 등록된 것처럼 보이면 안 된다.
    throw new ApiError('NOT_SAVED', '등록되지 않았습니다. 권한을 확인해 주세요.');
  }
  return rows[0];
}

/**
 * 취소한다. 행은 남기고 상태만 바꾼다.
 * 시청 기록은 그대로 두므로 다시 등록하면 진도가 이어진다.
 */
export async function cancelEnrollment(userId, classId) {
  const rows = await rest(
    '/enrollments?select=id,status&user_id=eq.' + userId + '&class_id=eq.' + classId,
    { method: 'PATCH', body: { status: '취소' }, prefer: 'return=representation' }
  );
  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '취소되지 않았습니다. 권한을 확인해 주세요.');
  }
  return rows[0];
}

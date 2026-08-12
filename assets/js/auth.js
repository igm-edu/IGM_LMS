import {
  ApiError, authCall, rest, getSession, saveSession, clearSession, toSession,
} from './api.js';

/**
 * 프로필에서 화면으로 가져오는 항목.
 * birth_date 는 수료증 발급 전용이고 동의 기록은 보여줄 이유가 없어 뺀다.
 * 서버도 본인 행만 내주지만, 필요한 것만 요청하는 편이 화면 코드가 단순하다.
 */
const PROFILE_FIELDS = 'id,email,name,phone,company,position,role,status,created_at';

/** 본인이 고칠 수 있는 항목. 서버는 열 권한으로 같은 제한을 건다. */
const EDITABLE_FIELDS = ['name', 'phone', 'company', 'position', 'birth_date'];

const REQUIRED_SIGNUP_FIELDS = [
  'name', 'email', 'password', 'phone', 'company', 'position', 'birth_date',
];

export function isLoggedIn() {
  return !!getSession();
}

function normalizeEmail(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
}

/** 통과하면 null, 아니면 사용자에게 보여줄 사유. 서버 정책과 같은 규칙이다. */
export function validatePassword(value) {
  const password = String(value === undefined || value === null ? '' : value);
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (!/[A-Za-z]/.test(password)) return '비밀번호에 영문자를 포함해야 합니다.';
  if (!/[0-9]/.test(password)) return '비밀번호에 숫자를 포함해야 합니다.';
  return null;
}

export async function signup(payload) {
  const missing = REQUIRED_SIGNUP_FIELDS.filter(function (field) {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length) {
    throw new ApiError('BAD_REQUEST', '필수 항목이 비어 있습니다: ' + missing.join(', '));
  }
  if (payload.consent !== true) {
    throw new ApiError('BAD_REQUEST', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
  }
  const passwordError = validatePassword(payload.password);
  if (passwordError) {
    throw new ApiError('BAD_REQUEST', passwordError);
  }

  // 역할은 보내지 않는다. 보내도 서버 트리거가 무시하지만, 보내지 않는 것이
  // 이 값을 클라이언트가 정하지 않는다는 뜻을 코드로 남기는 방법이다.
  const body = await authCall('/signup', {
    email: normalizeEmail(payload.email),
    password: payload.password,
    data: {
      name: String(payload.name).trim(),
      phone: String(payload.phone).trim(),
      company: String(payload.company).trim(),
      position: String(payload.position).trim(),
      birth_date: String(payload.birth_date).trim(),
    },
  });

  // 이메일 확인이 켜져 있으면 세션 없이 돌아온다. 그대로 두면 가입은 됐는데
  // 화면은 아무 말 없이 멈춘 것처럼 보인다.
  if (!body.access_token) {
    throw new ApiError('CONFIRM_REQUIRED', '가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 주세요.');
  }

  saveSession(toSession(body));
  return me();
}

export async function login(email, password) {
  const body = await authCall('/token?grant_type=password', {
    email: normalizeEmail(email),
    password: password,
  });
  saveSession(toSession(body));
  return me();
}

/** 서버 호출이 실패해도 로컬 세션은 반드시 지운다. */
export async function logout() {
  const session = getSession();
  try {
    if (session) await authCall('/logout', {}, session.access_token);
  } catch (err) {
    // 연결이 끊겼거나 토큰이 이미 죽었어도 이 기기는 로그아웃 상태여야 한다.
  } finally {
    clearSession();
  }
}

/**
 * 내 프로필. 세션의 user_id 로 조회한다.
 * 서버 정책이 본인 행만 내주므로 이 조건은 편의이지 방어가 아니다.
 */
export async function me() {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');

  const rows = await rest('/profiles?select=' + PROFILE_FIELDS + '&id=eq.' + session.user_id);
  if (!rows || !rows.length) {
    // 계정은 있는데 프로필 행이 없는 상태. 가입 트리거가 실패했을 때 생긴다.
    throw new ApiError('NO_PROFILE', '계정 정보를 찾을 수 없습니다. 관리자에게 문의해 주세요.');
  }
  return rows[0];
}

export async function updateProfile(patch) {
  const session = getSession();
  if (!session) throw new ApiError('NO_SESSION', '로그인이 필요합니다.');

  const body = {};
  const blanked = [];
  EDITABLE_FIELDS.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
    const value = patch[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      // 보내긴 했는데 비어 있으면 "지우겠다"는 뜻이다. 다섯 항목 모두 가입 시
      // 필수라 비울 수 없으므로 조용히 무시하지 않고 알려준다.
      blanked.push(field);
      return;
    }
    body[field] = String(value).trim();
  });

  if (blanked.length) {
    throw new ApiError('BAD_REQUEST', '비울 수 없는 항목입니다: ' + blanked.join(', '));
  }
  if (!Object.keys(body).length) {
    return me();
  }

  const rows = await rest(
    '/profiles?select=' + PROFILE_FIELDS + '&id=eq.' + session.user_id,
    { method: 'PATCH', body: body, prefer: 'return=representation' }
  );
  return rows && rows.length ? rows[0] : me();
}

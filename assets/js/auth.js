import { call, ApiError } from './api.js';

export const TOKEN_KEY = 'igm_lms_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

/**
 * 토큰이 필요한 요청. 토큰이 만료되거나 무효라고 서버가 답하면
 * 저장된 토큰을 지운다. 남겨두면 화면이 로그인 상태라고 착각한다.
 */
async function callAuthed(action, payload) {
  try {
    return await call(action, payload, getToken());
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'TOKEN_EXPIRED' || err.code === 'TOKEN_INVALID')) {
      clearToken();
    }
    throw err;
  }
}

export async function signup(payload) {
  const data = await call('auth.signup', payload);
  saveToken(data.token);
  return data.user;
}

export async function login(email, password) {
  const data = await call('auth.login', { email: email, password: password });
  saveToken(data.token);
  return data.user;
}

/** 서버 호출이 실패해도 로컬 토큰은 반드시 지운다. */
export async function logout() {
  try {
    await callAuthed('auth.logout', {});
  } catch (err) {
    // 연결이 끊겼거나 토큰이 이미 죽었어도 로컬은 로그아웃 상태여야 한다.
  } finally {
    clearToken();
  }
}

export async function me() {
  return callAuthed('auth.me', {});
}

export async function updateProfile(patch) {
  return callAuthed('auth.updateProfile', patch);
}

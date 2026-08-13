'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let comp;

async function load(withSession) {
  api = await import('../assets/js/api.js');
  comp = await import('../assets/js/completion.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
  if (withSession !== false) {
    api.saveSession({
      access_token: 'ACCESS1', refresh_token: 'REFRESH1',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'U-1',
    });
  }
}

const json = (value) => ({ text: JSON.stringify(value) });

const ROW = {
  user_id: 'U-1', class_id: 'C-1',
  total_watch_rate: 88.69, total_quiz_score: 60,
  is_completed: true,
  watch_rate_threshold_at_completion: 80, quiz_pass_score_at_completion: 60,
  completed_at: '2026-08-13T04:00:00Z',
};

// ---------------------------------------------------------------------------
// 판정 실행
// ---------------------------------------------------------------------------

test('클래스 전원 판정은 서버 함수로 보낸다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    await comp.judgeClass('C-1');
    const sent = shim.lastRequest();
    assert.match(String(sent.url), /\/rpc\/judge_class_completions$/);
    assert.deepStrictEqual(JSON.parse(sent.options.body), { p_class_id: 'C-1' });
  } finally {
    shim.restoreFetch();
  }
});

test('한 사람 판정도 서버 함수로 보낸다', async () => {
  await load();
  shim.installFetch(async () => json([{ total_watch_rate: 90, is_completed: true }]));
  try {
    const row = await comp.judgeOne('U-2', 'C-1');
    assert.strictEqual(row.is_completed, true);
    assert.deepStrictEqual(JSON.parse(shim.lastRequest().options.body),
      { p_user_id: 'U-2', p_class_id: 'C-1' });
  } finally {
    shim.restoreFetch();
  }
});

test('판정 결과가 비면 성공한 것처럼 넘기지 않는다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    await assert.rejects(() => comp.judgeOne('U-2', 'C-1'), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

test('내 판정 기록은 본인 것만 조회한다', async () => {
  await load();
  shim.installFetch(async () => json([ROW]));
  try {
    const row = await comp.myAttendance('C-1');
    assert.strictEqual(row.is_completed, true);
    const url = String(shim.lastRequest().url);
    assert.match(url, /class_id=eq\.C-1/);
    assert.match(url, /user_id=eq\.U-1/);
  } finally {
    shim.restoreFetch();
  }
});

test('판정 기록이 없으면 null을 돌려준다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    assert.strictEqual(await comp.myAttendance('C-1'), null);
  } finally {
    shim.restoreFetch();
  }
});

test('세션이 없으면 요청하지 않는다', async () => {
  await load(false);
  shim.installFetch(async () => json([]));
  try {
    await assert.rejects(() => comp.myAttendance('C-1'), (err) => {
      assert.strictEqual(err.code, 'NO_SESSION');
      return true;
    });
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

test('판정 기록 조회는 판정을 실행하지 않는다', async () => {
  await load();
  shim.installFetch(async () => json([ROW]));
  try {
    await comp.classAttendance('C-1');
    // 목록을 여는 것만으로 판정이 다시 내려지면 completed_at 이 흔들린다.
    assert.strictEqual(String(shim.lastRequest().url).indexOf('/rpc/'), -1);
    assert.strictEqual(shim.lastRequest().options.method || 'GET', 'GET');
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 표시
// ---------------------------------------------------------------------------

test('요약은 판정 당시의 기준값을 쓴다', async () => {
  await load();
  // 클래스의 현재 기준을 쓰면 이미 발급한 수료증의 근거와 화면이 어긋난다.
  assert.strictEqual(comp.completionLabel(ROW),
    '시청 89% (기준 80%) · 퀴즈 60점 (기준 60점) · 수료');
});

test('퀴즈가 없는 클래스는 점수 대신 그렇다고 적는다', async () => {
  await load();
  // 저장된 0 을 그대로 보여주면 0점을 받은 것처럼 읽힌다.
  const label = comp.completionLabel(
    Object.assign({}, ROW, { total_quiz_score: 0 }), { hasQuiz: false });
  assert.match(label, /퀴즈 없음/);
  assert.strictEqual(label.indexOf('0점'), -1);
});

test('판정 전에는 그렇다고 알려준다', async () => {
  await load();
  assert.strictEqual(comp.completionLabel(null), '아직 판정하지 않았습니다.');
});

test('미수료도 그대로 표시한다', async () => {
  await load();
  const label = comp.completionLabel(
    Object.assign({}, ROW, { total_watch_rate: 40, is_completed: false }));
  assert.match(label, /시청 40%/);
  assert.match(label, /미수료$/);
});

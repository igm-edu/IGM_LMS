'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let learn;

async function load(withSession) {
  api = await import('../assets/js/api.js');
  learn = await import('../assets/js/learn.js');
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

const CLASS_A = { id: 'C-1', class_name: 'AI 활용', batch: '1기', status: '진행중', watch_rate_threshold: 80 };

// ---------------------------------------------------------------------------
// 내 클래스
// ---------------------------------------------------------------------------

test('수강 중인 클래스만 요청한다', async () => {
  await load();
  shim.installFetch(async () => json([{ classes: CLASS_A }]));

  try {
    const rows = await learn.myClasses();
    assert.deepStrictEqual(rows, [CLASS_A]);
    const url = decodeURIComponent(String(shim.lastRequest().url));
    assert.match(url, /user_id=eq\.U-1/);
    assert.match(url, /status=eq\.수강중/);
  } finally {
    shim.restoreFetch();
  }
});

test('정책에 걸려 비어 온 클래스는 목록에서 뺀다', async () => {
  await load();
  // 조인 대상이 막히면 classes 가 null 로 온다. 그대로 두면 화면이 빈 칸을 그린다.
  shim.installFetch(async () => json([{ classes: CLASS_A }, { classes: null }]));

  try {
    assert.deepStrictEqual(await learn.myClasses(), [CLASS_A]);
  } finally {
    shim.restoreFetch();
  }
});

test('세션이 없으면 요청하지 않는다', async () => {
  await load(false);
  shim.installFetch(async () => json([]));

  try {
    await assert.rejects(() => learn.myClasses(), (err) => {
      assert.strictEqual(err.code, 'NO_SESSION');
      return true;
    });
    await assert.rejects(() => learn.saveProgress('L-1', 10), (err) => {
      assert.strictEqual(err.code, 'NO_SESSION');
      return true;
    });
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 차시와 진도
// ---------------------------------------------------------------------------

test('차시는 내 시청 기록을 함께 순서대로 가져온다', async () => {
  await load();
  shim.installFetch(async () => json([]));

  try {
    await learn.myLessons('C-1');
    const url = String(shim.lastRequest().url);
    assert.match(url, /watch_logs\(max_watched_sec,watch_rate,completed\)/);
    assert.match(url, /class_id=eq\.C-1/);
    assert.match(url, /order=lesson_order\.asc,id\.asc/);
  } finally {
    shim.restoreFetch();
  }
});

test('시청 기록이 없으면 0에서 시작한 것으로 본다', async () => {
  await load();
  assert.deepStrictEqual(learn.progressOf({ watch_logs: [] }),
    { max_watched_sec: 0, watch_rate: 0, completed: false });
  assert.deepStrictEqual(learn.progressOf({}),
    { max_watched_sec: 0, watch_rate: 0, completed: false });
  assert.deepStrictEqual(learn.progressOf({ watch_logs: [{ max_watched_sec: 300, watch_rate: 50, completed: false }] }),
    { max_watched_sec: 300, watch_rate: 50, completed: false });
});

test('진도 문구는 상태에 따라 달라진다', async () => {
  await load();
  assert.strictEqual(learn.progressLabel({ watch_rate: 0, completed: false }, 80), '아직 보지 않음');
  assert.strictEqual(learn.progressLabel({ watch_rate: 45.6, completed: false }, 80), '46% 시청 (기준 80%)');
  assert.strictEqual(learn.progressLabel({ watch_rate: 100, completed: true }, 80), '수강 완료 · 100%');
});

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

test('시청 위치는 upsert로 한 번에 보낸다', async () => {
  await load();
  shim.installFetch(async () => json([{ max_watched_sec: 300, watch_rate: 50, completed: false }]));

  try {
    const saved = await learn.saveProgress('L-1', 300.7);
    assert.strictEqual(saved.watch_rate, 50);

    const sent = shim.lastRequest();
    assert.strictEqual(sent.options.method, 'POST');
    // 조회 후 삽입이면 두 탭에서 동시에 열었을 때 둘 다 insert 를 시도한다.
    assert.match(String(sent.url), /on_conflict=user_id,lesson_id/);
    assert.match(sent.options.headers.Prefer, /resolution=merge-duplicates/);
    assert.deepStrictEqual(JSON.parse(sent.options.body),
      { user_id: 'U-1', lesson_id: 'L-1', max_watched_sec: 300 });
  } finally {
    shim.restoreFetch();
  }
});

test('비율이 아니라 초만 보낸다', async () => {
  await load();
  shim.installFetch(async () => json([{ max_watched_sec: 0, watch_rate: 0, completed: false }]));

  try {
    await learn.saveProgress('L-1', 10);
    const body = JSON.parse(shim.lastRequest().options.body);
    // 비율을 클라이언트가 보내면 0초에 100%를 보낼 수 있다. 서버 트리거가 계산한다.
    assert.strictEqual(body.watch_rate, undefined);
    assert.strictEqual(body.completed, undefined);
  } finally {
    shim.restoreFetch();
  }
});

test('이상한 값은 0으로 눕힌다', async () => {
  await load();
  shim.installFetch(async () => json([{ max_watched_sec: 0 }]));

  try {
    for (const value of [-5, NaN, undefined, 'abc']) {
      await learn.saveProgress('L-1', value);
      assert.strictEqual(JSON.parse(shim.lastRequest().options.body).max_watched_sec, 0);
    }
  } finally {
    shim.restoreFetch();
  }
});

test('저장 결과가 0건이면 저장된 것처럼 넘기지 않는다', async () => {
  await load();
  shim.installFetch(async () => json([]));

  try {
    await assert.rejects(() => learn.saveProgress('L-1', 10), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('저장 시점은 마지막 저장 위치에서 충분히 나아갔을 때만이다', async () => {
  await load();
  // 매 초 보내면 한 시간짜리 영상 하나에 3,600번을 쓴다.
  assert.strictEqual(learn.shouldSave(0, 5), false);
  assert.strictEqual(learn.shouldSave(0, 14.9), false);
  assert.strictEqual(learn.shouldSave(0, 15), true);
  assert.strictEqual(learn.shouldSave(100, 120), true);
  // 뒤로 감아도 저장하지 않는다. 누적값은 어차피 줄지 않는다.
  assert.strictEqual(learn.shouldSave(100, 20), false);
  assert.strictEqual(learn.shouldSave(0, 5, 3), true);
});

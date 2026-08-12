'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let cl;

async function load() {
  api = await import('../assets/js/api.js');
  cl = await import('../assets/js/classes.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
  api.saveSession({
    access_token: 'ACCESS1', refresh_token: 'REFRESH1',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'U-1',
  });
}

const CLASS_ROW = {
  id: 'C-1', class_name: '검증 클래스', batch: '1기', instructor_id: null,
  start_date: null, end_date: null, watch_rate_threshold: 80, quiz_pass_score: 60,
  quiz_retry_allowed: false, status: '모집중',
};

function classFields(overrides) {
  return Object.assign({
    class_name: '새 과정', batch: '2기', watch_rate_threshold: 80, quiz_pass_score: 60,
  }, overrides || {});
}

function lessonFields(overrides) {
  return Object.assign({
    class_id: 'C-1', title: '1차시', video_url: 'https://cdn.test/a.mp4',
    video_duration_sec: 600,
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

test('클래스 필수 항목과 범위를 검사한다', async () => {
  await load();
  assert.match(cl.validateClass(classFields({ class_name: '  ' })), /과정명/);
  assert.match(cl.validateClass(classFields({ batch: '' })), /기수/);
  assert.match(cl.validateClass(classFields({ watch_rate_threshold: 120 })), /0~100/);
  assert.match(cl.validateClass(classFields({ quiz_pass_score: -1 })), /0~100/);
  assert.match(cl.validateClass(classFields({ status: '모집' })), /상태/);
  assert.strictEqual(cl.validateClass(classFields()), null);
});

test('출결 기준에 불리언을 넣으면 거부한다', async () => {
  await load();
  // Number(false)가 0이라 타입을 보지 않으면 통과한다. 그러면 기준이 0%가 되어
  // 아무도 보지 않아도 전원 수료가 된다.
  assert.match(cl.validateClass(classFields({ watch_rate_threshold: false })), /0~100/);
  assert.match(cl.validateClass(classFields({ quiz_pass_score: true })), /0~100/);
});

test('기간은 둘 다 있을 때만 순서를 본다', async () => {
  await load();
  assert.strictEqual(cl.validateClass(classFields({ start_date: '2026-09-01' })), null);
  assert.strictEqual(cl.validateClass(classFields({ end_date: '2026-09-30' })), null);
  assert.strictEqual(
    cl.validateClass(classFields({ start_date: '2026-09-01', end_date: '2026-09-30' })), null);
  assert.match(
    cl.validateClass(classFields({ start_date: '2026-09-30', end_date: '2026-09-01' })), /종료일/);
});

test('차시는 https 주소와 0보다 큰 길이를 요구한다', async () => {
  await load();
  assert.match(cl.validateLesson(lessonFields({ title: '' })), /제목/);
  assert.match(cl.validateLesson(lessonFields({ video_url: 'http://cdn.test/a.mp4' })), /https/);
  assert.match(cl.validateLesson(lessonFields({ video_duration_sec: 0 })), /길이/);
  assert.match(cl.validateLesson(lessonFields({ video_duration_sec: '' })), /길이/);
  assert.match(cl.validateLesson(lessonFields({ lesson_order: 0 })), /1 이상/);
  assert.match(cl.validateLesson(lessonFields({ lesson_order: '두번째' })), /1 이상/);
  assert.strictEqual(cl.validateLesson(lessonFields({ lesson_order: 3 })), null);
});

test('검증에 걸리면 요청을 보내지 않는다', async () => {
  await load();
  shim.installFetch(async () => ({ text: JSON.stringify([CLASS_ROW]) }));
  try {
    await assert.rejects(() => cl.saveClass(classFields({ watch_rate_threshold: 120 })), /0~100/);
    await assert.rejects(() => cl.saveLesson(lessonFields({ video_url: 'http://x/a.mp4' })), /https/);
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

test('id가 없으면 POST, 있으면 PATCH로 보낸다', async () => {
  await load();
  shim.installFetch(async () => ({ text: JSON.stringify([CLASS_ROW]) }));

  try {
    await cl.saveClass(classFields());
    assert.strictEqual(shim.lastRequest().options.method, 'POST');

    await cl.saveClass(classFields(), 'C-1');
    const sent = shim.lastRequest();
    assert.strictEqual(sent.options.method, 'PATCH');
    assert.match(String(sent.url), /id=eq\.C-1/);
  } finally {
    shim.restoreFetch();
  }
});

test('수정은 보낸 항목만 반영한다', async () => {
  await load();
  shim.installFetch(async () => ({ text: JSON.stringify([CLASS_ROW]) }));

  try {
    // 담당 강사·기간·상태를 보내지 않았으니 요청 본문에도 없어야 한다.
    // 있으면 기존 값이 빈 값으로 덮인다.
    await cl.saveClass({ class_name: '이름만 바꿈', batch: '1기', watch_rate_threshold: 80, quiz_pass_score: 60 }, 'C-1');
    const body = JSON.parse(shim.lastRequest().options.body);
    assert.deepStrictEqual(Object.keys(body).sort(),
      ['batch', 'class_name', 'quiz_pass_score', 'watch_rate_threshold']);
  } finally {
    shim.restoreFetch();
  }
});

test('정책이 걸러 0건이 오면 저장된 것처럼 넘기지 않는다', async () => {
  await load();
  shim.installFetch(async () => ({ text: '[]' }));

  try {
    await assert.rejects(() => cl.saveClass(classFields()), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
    await assert.rejects(() => cl.saveLesson(lessonFields()), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('차시 목록은 순서대로 요청한다', async () => {
  await load();
  shim.installFetch(async () => ({ text: '[]' }));

  try {
    await cl.listLessons('C-1');
    const url = String(shim.lastRequest().url);
    assert.match(url, /class_id=eq\.C-1/);
    // 같은 순서 번호가 잠시 존재할 수 있어(맞바꾸기 중간 상태) 두 번째 기준이 필요하다.
    assert.match(url, /order=lesson_order\.asc,id\.asc/);
  } finally {
    shim.restoreFetch();
  }
});

test('시청 기록이 있는 차시 삭제는 이유를 알려준다', async () => {
  await load();
  shim.installFetch(async () => ({
    status: 409,
    text: JSON.stringify({ code: '23503', details: 'still referenced from table "watch_logs"' }),
  }));

  try {
    await assert.rejects(() => cl.deleteLesson('L-1'), (err) => {
      assert.strictEqual(err.code, 'IN_USE');
      assert.match(err.message, /시청 기록/);
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('강사 후보는 서버 함수로 가져온다', async () => {
  await load();
  shim.installFetch(async () => ({ text: '[]' }));

  try {
    await cl.listInstructors();
    assert.match(String(shim.lastRequest().url), /\/rpc\/list_instructors$/);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 순서와 표시
// ---------------------------------------------------------------------------

test('nextLessonOrder는 가장 큰 순서 다음을 준다', async () => {
  await load();
  assert.strictEqual(cl.nextLessonOrder([]), 1);
  assert.strictEqual(cl.nextLessonOrder([{ lesson_order: 1 }, { lesson_order: 3 }]), 4);
  assert.strictEqual(cl.nextLessonOrder([{ lesson_order: '2' }]), 3);
  assert.strictEqual(cl.nextLessonOrder([{ lesson_order: null }]), 1);
});

test('formatDuration은 분과 초로 보여준다', async () => {
  await load();
  assert.strictEqual(cl.formatDuration(600), '10분 00초');
  assert.strictEqual(cl.formatDuration(605), '10분 05초');
  assert.strictEqual(cl.formatDuration(59), '0분 59초');
  assert.strictEqual(cl.formatDuration(null), '0분 00초');
});

// ---------------------------------------------------------------------------
// 영상 길이 측정
// ---------------------------------------------------------------------------

/** 가짜 video element. src 를 넣으면 지정한 사건을 일으킨다. */
function fakeVideo(behaviour) {
  const listeners = {};
  return {
    listeners: listeners,
    duration: behaviour.duration,
    preload: '',
    addEventListener(name, fn) { listeners[name] = fn; },
    set src(value) {
      if (!value) return;                      // finish()가 끊는 호출
      if (behaviour.event === 'none') return;  // 아무 일도 없는 경우(시간초과)
      setTimeout(() => {
        if (listeners[behaviour.event]) listeners[behaviour.event]();
      }, 1);
    },
    get src() { return ''; },
  };
}

test('메타데이터를 읽어 길이를 초로 돌려준다', async () => {
  await load();
  const video = fakeVideo({ event: 'loadedmetadata', duration: 600.4 });
  const seconds = await cl.measureVideoDuration('https://cdn.test/a.mp4', {
    createElement: () => video,
  });
  assert.strictEqual(seconds, 600);
  assert.strictEqual(video.preload, 'metadata', '전체를 받지 않아야 한다');
});

test('길이가 Infinity면 실패로 본다', async () => {
  await load();
  // 스트리밍 형식에서 온다. 그대로 저장하면 시청률이 늘 0이 된다.
  await assert.rejects(
    () => cl.measureVideoDuration('https://cdn.test/live', {
      createElement: () => fakeVideo({ event: 'loadedmetadata', duration: Infinity }),
    }),
    (err) => {
      assert.strictEqual(err.code, 'MEASURE_FAILED');
      assert.match(err.message, /직접 입력/);
      return true;
    }
  );
});

test('불러오지 못하면 직접 입력하라고 안내한다', async () => {
  await load();
  await assert.rejects(
    () => cl.measureVideoDuration('https://cdn.test/none.mp4', {
      createElement: () => fakeVideo({ event: 'error' }),
    }),
    (err) => {
      assert.strictEqual(err.code, 'MEASURE_FAILED');
      return true;
    }
  );
});

test('응답이 없으면 기다리다 시간초과로 끝낸다', async () => {
  await load();
  await assert.rejects(
    () => cl.measureVideoDuration('https://cdn.test/slow.mp4', {
      createElement: () => fakeVideo({ event: 'none' }),
      timeoutMs: 5,
    }),
    (err) => {
      assert.strictEqual(err.code, 'MEASURE_TIMEOUT');
      return true;
    }
  );
});

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

// ---------------------------------------------------------------------------
// 수료증
// ---------------------------------------------------------------------------

test('클래스 일괄 발급은 서버 함수로 보낸다', async () => {
  await load();
  shim.installFetch(async () => json([{ user_id: 'U-1', name: '홍길동', certificate_no: 'IGM-2026-0001', already: false }]));
  try {
    const rows = await comp.issueClassCertificates('C-1');
    assert.strictEqual(rows[0].certificate_no, 'IGM-2026-0001');
    assert.match(String(shim.lastRequest().url), /\/rpc\/issue_class_certificates$/);
  } finally {
    shim.restoreFetch();
  }
});

test('한 장 발급도 서버 함수로 보내고 빈 결과를 넘기지 않는다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    await assert.rejects(() => comp.issueCertificate('A-1'), (err) => {
      assert.strictEqual(err.code, 'NOT_SAVED');
      return true;
    });
    assert.deepStrictEqual(JSON.parse(shim.lastRequest().options.body), { p_attendance_id: 'A-1' });
  } finally {
    shim.restoreFetch();
  }
});

test('수료증 조회는 발급을 실행하지 않는다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    await comp.classCertificates('C-1');
    const url = decodeURIComponent(String(shim.lastRequest().url));
    // 목록을 여는 것만으로 번호가 채번되면 안 된다.
    assert.strictEqual(url.indexOf('/rpc/'), -1);
    assert.match(url, /attendance!inner/);
    assert.match(url, /attendance\.class_id=eq\.C-1/);
  } finally {
    shim.restoreFetch();
  }
});

test('내 수료증은 본인 것만 조회한다', async () => {
  await load();
  shim.installFetch(async () => json([{ certificate_no: 'IGM-2026-0007', attendance: { user_id: 'U-1', class_id: 'C-1' } }]));
  try {
    const row = await comp.myCertificate('C-1');
    assert.strictEqual(row.certificate_no, 'IGM-2026-0007');
    assert.match(decodeURIComponent(String(shim.lastRequest().url)), /attendance\.user_id=eq\.U-1/);
  } finally {
    shim.restoreFetch();
  }
});

test('수료증이 없으면 null을 돌려준다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    assert.strictEqual(await comp.myCertificate('C-1'), null);
  } finally {
    shim.restoreFetch();
  }
});

test('수료증 목록을 user_id로 찾을 수 있게 바꾼다', async () => {
  await load();
  const map = comp.certificatesByUser([
    { certificate_no: 'IGM-2026-0001', attendance: { user_id: 'U-1' } },
    { certificate_no: 'IGM-2026-0002', attendance: { user_id: 'U-2' } },
    { certificate_no: 'IGM-2026-0003' },   // 조인이 막혀 비어 온 행
  ]);
  assert.strictEqual(map['U-1'].certificate_no, 'IGM-2026-0001');
  assert.strictEqual(map['U-2'].certificate_no, 'IGM-2026-0002');
  assert.strictEqual(Object.keys(map).length, 2);
  assert.deepStrictEqual(comp.certificatesByUser(null), {});
});

test('수료증 상세는 이름·과정·수료일을 함께 가져온다', async () => {
  await load();
  shim.installFetch(async () => json([]));
  try {
    await comp.certificateDetail('IGM-2026-0001');
    const url = decodeURIComponent(String(shim.lastRequest().url));
    assert.match(url, /certificate_no=eq\.IGM-2026-0001/);
    assert.match(url, /attendance!inner\(/);
    assert.match(url, /profiles!inner\(name\)/);
    assert.match(url, /classes!inner\(class_name,batch\)/);
  } finally {
    shim.restoreFetch();
  }
});

test('상세를 인쇄용 값으로 편다', async () => {
  await load();
  const fields = comp.certificateFields({
    certificate_no: 'IGM-2026-0001', issued_at: '2026-08-20T00:00:00Z',
    attendance: {
      completed_at: '2026-08-13T04:00:00Z',
      profiles: { name: '홍길동' },
      classes: { class_name: 'AI 활용 실무', batch: '2026-1기' },
    },
  });
  assert.strictEqual(fields.name, '홍길동');
  assert.strictEqual(fields.class_name, 'AI 활용 실무');
  assert.strictEqual(fields.batch, '2026-1기');
  // 발급일이 아니라 수료일을 찍는다. 12월 수료 / 1월 발급이면 날짜가 달라진다.
  assert.strictEqual(fields.completed_at, '2026-08-13T04:00:00Z');
});

test('조인이 막혀 비어 오면 null을 돌려준다', async () => {
  await load();
  // 남의 번호를 넣으면 certificates 행은 못 보고, 봐도 profiles 가 빈다.
  assert.strictEqual(comp.certificateFields(null), null);
  assert.strictEqual(comp.certificateFields({ certificate_no: 'X' }), null);
  assert.strictEqual(comp.certificateFields({
    certificate_no: 'X', attendance: { profiles: null, classes: { class_name: 'A' } },
  }), null);
});

test('수료일이 없으면 발급일로 대신한다', async () => {
  await load();
  const fields = comp.certificateFields({
    certificate_no: 'IGM-2026-0002', issued_at: '2026-09-01T00:00:00Z',
    attendance: { completed_at: null, profiles: { name: '김철수' }, classes: { class_name: 'B', batch: '1기' } },
  });
  assert.strictEqual(fields.completed_at, '2026-09-01T00:00:00Z');
});

test('날짜는 양식과 같은 영문 표기로 낸다', async () => {
  await load();
  // 한국 시간 기준 8월 13일. 보는 사람의 지역 설정과 무관하게 같아야 한다.
  assert.strictEqual(comp.formatCertificateDate('2026-08-13T04:00:00Z'), 'August 13, 2026');
  assert.strictEqual(comp.formatCertificateDate('2025-06-18T00:00:00Z'), 'June 18, 2025');
  assert.strictEqual(comp.formatCertificateDate('이상한값'), '');
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

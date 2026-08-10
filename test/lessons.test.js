'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const lessons = require('../apps-script/handlers/lessons');

const ADMIN = { user_id: 'U-ADMIN', role: 'admin' };

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Classes', {
    class_id: 'C1', class_name: '리더십', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
}

function lessonPayload(over) {
  return Object.assign({
    class_id: 'C1',
    title: '1차시 오리엔테이션',
    video_url: 'https://cdn.example.com/1.mp4',
    video_duration_sec: 1800,
  }, over || {});
}

test('차시를 등록하면 순서가 1부터 붙는다', () => {
  fresh();
  const a = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const b = lessons.handleLessonUpsert(lessonPayload({ title: '2차시' }), ADMIN);
  const c = lessons.handleLessonUpsert(lessonPayload({ title: '3차시' }), ADMIN);

  assert.strictEqual(a.lesson.lesson_order, 1);
  assert.strictEqual(b.lesson.lesson_order, 2);
  assert.strictEqual(c.lesson.lesson_order, 3);
});

test('없는 클래스에는 차시를 붙일 수 없다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ class_id: 'NOPE' }), ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /클래스/);
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('http 영상 주소를 거부한다', () => {
  fresh();
  assert.throws(
    () => lessons.handleLessonUpsert(lessonPayload({ video_url: 'http://cdn.example.com/1.mp4' }), ADMIN),
    /https/
  );
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('영상 길이가 0 이하이거나 숫자가 아니면 거부한다', () => {
  fresh();
  [0, -5, 'abc'].forEach((bad) => {
    assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ video_duration_sec: bad }), ADMIN), /영상 길이/);
  });
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('필수 항목이 비면 무엇이 빠졌는지 알려준다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ title: '' }), ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /title/);
    return true;
  });
});

test('lesson_id를 주면 수정이고 새로 만들지 않는다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const updated = lessons.handleLessonUpsert(
    lessonPayload({ lesson_id: created.lesson.lesson_id, title: '고친 제목' }), ADMIN
  );

  assert.strictEqual(updated.lesson.lesson_id, created.lesson.lesson_id);
  assert.strictEqual(updated.lesson.title, '고친 제목');
  assert.strictEqual(sheet.readAll('Lessons').length, 1);
});

test('없는 lesson_id로 수정하면 새로 만들지 않고 거부한다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ lesson_id: 'L-NOPE' }), ADMIN), /수정할 차시/);
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('차시의 소속 클래스는 바꿀 수 없다', () => {
  fresh();
  sheet.insert('Classes', {
    class_id: 'C2', class_name: '협상', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);

  assert.throws(
    () => lessons.handleLessonUpsert(lessonPayload({ lesson_id: created.lesson.lesson_id, class_id: 'C2' }), ADMIN),
    /소속 클래스/
  );
  assert.strictEqual(sheet.findByPk('Lessons', created.lesson.lesson_id).class_id, 'C1');
});

test('lessonsOfClass_는 순서대로 돌려주고 다른 클래스를 섞지 않는다', () => {
  fresh();
  sheet.insert('Classes', {
    class_id: 'C2', class_name: '협상', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
  lessons.handleLessonUpsert(lessonPayload({ title: '1차시' }), ADMIN);
  lessons.handleLessonUpsert(lessonPayload({ title: '2차시' }), ADMIN);
  lessons.handleLessonUpsert(lessonPayload({ class_id: 'C2', title: '남의 차시' }), ADMIN);

  const list = lessons.lessonsOfClass_('C1');
  assert.deepStrictEqual(list.map((l) => l.title), ['1차시', '2차시']);
});

test('시청 기록이 없는 차시는 지울 수 있다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const result = lessons.handleLessonDelete({ lesson_id: created.lesson.lesson_id }, ADMIN);

  assert.strictEqual(result.deleted, created.lesson.lesson_id);
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('시청 기록이 있는 차시는 지울 수 없고 몇 명이 봤는지 알려준다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const lessonId = created.lesson.lesson_id;
  sheet.insert('WatchLogs', { watch_log_id: 'U1_' + lessonId, user_id: 'U1', lesson_id: lessonId, max_watched_sec: 10 });
  sheet.insert('WatchLogs', { watch_log_id: 'U2_' + lessonId, user_id: 'U2', lesson_id: lessonId, max_watched_sec: 20 });

  assert.throws(() => lessons.handleLessonDelete({ lesson_id: lessonId }, ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /2명/);
    return true;
  });
  assert.strictEqual(sheet.readAll('Lessons').length, 1, '거부했으면 남아 있어야 한다');
});

test('없는 차시를 지우려 하면 거부한다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonDelete({ lesson_id: 'L-NOPE' }, ADMIN), /차시를 찾을 수 없습니다/);
  assert.throws(() => lessons.handleLessonDelete({}, ADMIN), /차시를 지정/);
});

test('순서를 숫자가 아닌 값으로 바꾸려 하면 조용히 무시하지 않고 거부한다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const id = created.lesson.lesson_id;

  ['삼', 'abc', 0, -1].forEach((bad) => {
    assert.throws(
      () => lessons.handleLessonUpsert(lessonPayload({ lesson_id: id, lesson_order: bad }), ADMIN),
      /차시 순서는 1 이상/,
      `막아야 함: ${bad}`
    );
  });

  assert.strictEqual(sheet.findByPk('Lessons', id).lesson_order, 1, '거부했으면 원래 순서가 남아야 한다');
});

test('순서를 생략하면 기존 값을 그대로 둔다', () => {
  fresh();
  lessons.handleLessonUpsert(lessonPayload({ title: '1차시' }), ADMIN);
  const second = lessons.handleLessonUpsert(lessonPayload({ title: '2차시' }), ADMIN);

  lessons.handleLessonUpsert(lessonPayload({ lesson_id: second.lesson.lesson_id, title: '제목만 변경' }), ADMIN);

  assert.strictEqual(sheet.findByPk('Lessons', second.lesson.lesson_id).lesson_order, 2);
});

test('순서가 겹치면 lesson_id 순으로 안정적으로 정렬한다', () => {
  fresh();
  // 순서 중복은 설계상 허용된다. 3번과 5번을 맞바꾸려면 중간에 같은 번호가 생긴다.
  sheet.insert('Lessons', { lesson_id: 'L-BBB', class_id: 'C1', lesson_order: 1, title: '나중', video_url: 'https://x/b.mp4', video_duration_sec: 60 });
  sheet.insert('Lessons', { lesson_id: 'L-AAA', class_id: 'C1', lesson_order: 1, title: '먼저', video_url: 'https://x/a.mp4', video_duration_sec: 60 });

  assert.deepStrictEqual(lessons.lessonsOfClass_('C1').map((l) => l.title), ['먼저', '나중']);
});

test('순서 값이 비어 있는 차시는 맨 앞으로 오되 순서가 흔들리지 않는다', () => {
  fresh();
  sheet.insert('Lessons', { lesson_id: 'L-1', class_id: 'C1', lesson_order: 2, title: '둘째', video_url: 'https://x/1.mp4', video_duration_sec: 60 });
  sheet.insert('Lessons', { lesson_id: 'L-2', class_id: 'C1', lesson_order: '', title: '순서없음', video_url: 'https://x/2.mp4', video_duration_sec: 60 });

  const titles = lessons.lessonsOfClass_('C1').map((l) => l.title);
  assert.deepStrictEqual(titles, ['순서없음', '둘째']);
  assert.deepStrictEqual(lessons.lessonsOfClass_('C1').map((l) => l.title), titles, '반복 호출해도 같아야 한다');
});

test('제목만 보내는 수정이 영상 주소와 길이를 지우지 않는다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const id = created.lesson.lesson_id;

  lessons.handleLessonUpsert({ lesson_id: id, class_id: 'C1', title: '고친 제목' }, ADMIN);

  const row = sheet.findByPk('Lessons', id);
  assert.strictEqual(row.title, '고친 제목');
  assert.strictEqual(row.video_url, 'https://cdn.example.com/1.mp4', '영상 주소가 지워졌다');
  assert.strictEqual(row.video_duration_sec, 1800, '영상 길이가 지워졌다');
});

test('영상 주소를 바꿀 때는 길이도 함께 보내야 한다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const id = created.lesson.lesson_id;

  // 길이 없이 주소만 바꾸면 이전 영상의 길이가 남아 시청률 분모가 틀어진다.
  assert.throws(
    () => lessons.handleLessonUpsert(
      { lesson_id: id, class_id: 'C1', video_url: 'https://cdn.example.com/new.mp4' }, ADMIN),
    /영상 길이도 함께/
  );
  assert.strictEqual(sheet.findByPk('Lessons', id).video_url, 'https://cdn.example.com/1.mp4');

  // 함께 보내면 통과한다.
  lessons.handleLessonUpsert(
    { lesson_id: id, class_id: 'C1', video_url: 'https://cdn.example.com/new.mp4', video_duration_sec: 600 }, ADMIN);
  const row = sheet.findByPk('Lessons', id);
  assert.strictEqual(row.video_url, 'https://cdn.example.com/new.mp4');
  assert.strictEqual(row.video_duration_sec, 600);
});

test('길이만 고치는 것은 허용한다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const id = created.lesson.lesson_id;

  // 자동 측정이 틀렸을 때 손으로 바로잡는 경로다.
  lessons.handleLessonUpsert({ lesson_id: id, class_id: 'C1', video_duration_sec: 1795 }, ADMIN);

  assert.strictEqual(sheet.findByPk('Lessons', id).video_duration_sec, 1795);
});

test('제목을 비우려는 수정은 거부한다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const id = created.lesson.lesson_id;

  assert.throws(
    () => lessons.handleLessonUpsert({ lesson_id: id, class_id: 'C1', title: '  ' }, ADMIN),
    /제목은 비울 수 없습니다/
  );
  assert.strictEqual(sheet.findByPk('Lessons', id).title, '1차시 오리엔테이션');
});

test('신규 등록에는 여전히 영상 주소와 길이가 필요하다', () => {
  fresh();
  assert.throws(
    () => lessons.handleLessonUpsert({ class_id: 'C1', title: '주소 없는 차시' }, ADMIN),
    /video_url/
  );
});

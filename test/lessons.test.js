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

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
const classes = require('../apps-script/handlers/classes');

const ADMIN = { user_id: 'U-ADMIN', role: 'admin' };
const STUDENT = { user_id: 'U-STU', role: 'student' };

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Users', {
    user_id: 'U-INS', name: '김강사', email: 'ins@igm.co.kr',
    password_hash: 'pbkdf2$3000$aa$bb', role: 'instructor', status: 'active',
  });
  sheet.insert('Users', {
    user_id: 'U-STU', name: '홍길동', email: 'stu@igm.co.kr',
    password_hash: 'pbkdf2$3000$cc$dd', role: 'student', status: 'active',
  });
}

function classPayload(over) {
  return Object.assign({
    class_name: '리더십 과정',
    batch: '1기',
    watch_rate_threshold: 80,
    quiz_pass_score: 60,
  }, over || {});
}

test('클래스를 만들면 기본 상태가 모집중이다', () => {
  fresh();
  const result = classes.handleClassUpsert(classPayload(), ADMIN);
  assert.strictEqual(result.class.status, '모집중');
  assert.ok(result.class.class_id);
  assert.strictEqual(sheet.readAll('Classes').length, 1);
});

test('기준값이 0~100을 벗어나면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ watch_rate_threshold: 120 }), ADMIN), /출결 기준/);
  assert.throws(() => classes.handleClassUpsert(classPayload({ quiz_pass_score: -1 }), ADMIN), /퀴즈 합격/);
  assert.throws(() => classes.handleClassUpsert(classPayload({ watch_rate_threshold: '' }), ADMIN), /출결 기준/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('정의되지 않은 상태 값을 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ status: '대기' }), ADMIN), /모집중/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('시작일이 종료일보다 늦으면 거부한다', () => {
  fresh();
  assert.throws(
    () => classes.handleClassUpsert(classPayload({ start_date: '2026-05-01', end_date: '2026-04-01' }), ADMIN),
    /종료일/
  );
});

test('없는 담당 강사를 지정하면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ instructor_id: 'U-NOPE' }), ADMIN), /담당 강사를 찾을 수 없/);
});

test('강사도 관리자도 아닌 사용자는 담당 강사가 될 수 없다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ instructor_id: 'U-STU' }), ADMIN), /강사 또는 관리자/);
});

test('담당 강사를 비워두고 클래스를 열 수 있다', () => {
  fresh();
  const result = classes.handleClassUpsert(classPayload({ instructor_id: '' }), ADMIN);
  assert.strictEqual(result.class.instructor_id, '');
});

test('class_id를 주면 수정이고 새로 만들지 않는다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload(), ADMIN);
  const updated = classes.handleClassUpsert(
    classPayload({ class_id: created.class.class_id, class_name: '고친 이름', status: '진행중' }), ADMIN
  );

  assert.strictEqual(updated.class.class_id, created.class.class_id);
  assert.strictEqual(updated.class.class_name, '고친 이름');
  assert.strictEqual(updated.class.status, '진행중');
  assert.strictEqual(sheet.readAll('Classes').length, 1);
});

test('없는 class_id로 수정하면 새로 만들지 않고 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ class_id: 'C-NOPE' }), ADMIN), /수정할 클래스/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('학생에게는 종료된 클래스를 보여주지 않는다', () => {
  fresh();
  classes.handleClassUpsert(classPayload({ class_name: '열린 과정', status: '모집중' }), ADMIN);
  classes.handleClassUpsert(classPayload({ class_name: '진행 과정', status: '진행중' }), ADMIN);
  classes.handleClassUpsert(classPayload({ class_name: '끝난 과정', status: '종료' }), ADMIN);

  const forStudent = classes.handleClassList({}, STUDENT).classes.map((c) => c.class_name);
  const forAdmin = classes.handleClassList({}, ADMIN).classes.map((c) => c.class_name);

  assert.deepStrictEqual(forStudent.sort(), ['열린 과정', '진행 과정'].sort());
  assert.strictEqual(forAdmin.length, 3);
});

test('class.get은 클래스와 차시를 순서대로 함께 준다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ instructor_id: 'U-INS' }), ADMIN);
  const classId = created.class.class_id;
  lessons.handleLessonUpsert({ class_id: classId, title: '1차시', video_url: 'https://x/1.mp4', video_duration_sec: 600 }, ADMIN);
  lessons.handleLessonUpsert({ class_id: classId, title: '2차시', video_url: 'https://x/2.mp4', video_duration_sec: 900 }, ADMIN);

  const detail = classes.handleClassGet({ class_id: classId }, STUDENT);
  assert.strictEqual(detail.class.class_id, classId);
  assert.deepStrictEqual(detail.lessons.map((l) => l.title), ['1차시', '2차시']);
});

test('담당 강사 정보에 비밀번호 해시가 실리지 않는다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ instructor_id: 'U-INS' }), ADMIN);
  const detail = classes.handleClassGet({ class_id: created.class.class_id }, STUDENT);

  assert.strictEqual(detail.instructor.name, '김강사');
  assert.strictEqual(detail.instructor.password_hash, undefined);
  assert.strictEqual(JSON.stringify(detail).indexOf('pbkdf2'), -1);
});

test('학생은 종료된 클래스를 직접 조회할 수도 없다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ status: '종료' }), ADMIN);
  assert.throws(() => classes.handleClassGet({ class_id: created.class.class_id }, STUDENT), /찾을 수 없/);
  assert.ok(classes.handleClassGet({ class_id: created.class.class_id }, ADMIN).class);
});

test('없는 클래스를 조회하면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassGet({ class_id: 'C-NOPE' }, ADMIN), /찾을 수 없/);
  assert.throws(() => classes.handleClassGet({}, ADMIN), /클래스를 지정/);
});

test('일부 항목만 보낸 편집은 나머지를 지우지 않는다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({
    instructor_id: 'U-INS',
    start_date: '2026-03-01',
    end_date: '2026-03-31',
    quiz_retry_allowed: true,
    status: '진행중',
  }), ADMIN);
  const id = created.class.class_id;

  // 이름만 고치는 요청. 나머지 항목은 아예 담기지 않는다.
  classes.handleClassUpsert({
    class_id: id,
    class_name: '고친 이름',
    batch: '1기',
    watch_rate_threshold: 80,
    quiz_pass_score: 60,
  }, ADMIN);

  const row = sheet.findByPk('Classes', id);
  assert.strictEqual(row.class_name, '고친 이름');
  assert.strictEqual(row.instructor_id, 'U-INS', '담당 강사가 지워졌다');
  assert.strictEqual(String(row.start_date), '2026-03-01', '시작일이 지워졌다');
  assert.strictEqual(String(row.end_date), '2026-03-31', '종료일이 지워졌다');
  assert.strictEqual(row.quiz_retry_allowed, true, '재응시 설정이 꺼졌다');
  assert.strictEqual(row.status, '진행중', '상태가 모집중으로 되돌아갔다');
});

test('명시적으로 보낸 빈 값은 실제로 비운다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ instructor_id: 'U-INS' }), ADMIN);
  const id = created.class.class_id;

  classes.handleClassUpsert(classPayload({ class_id: id, instructor_id: '' }), ADMIN);

  assert.strictEqual(sheet.findByPk('Classes', id).instructor_id, '', '보낸 빈 값은 반영되어야 한다');
});

test('신규 생성에서 선택 항목을 생략하면 기본값이 채워진다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload(), ADMIN);
  const row = sheet.findByPk('Classes', created.class.class_id);

  assert.strictEqual(row.status, '모집중');
  assert.strictEqual(row.instructor_id, '');
  assert.strictEqual(row.quiz_retry_allowed, false);
});

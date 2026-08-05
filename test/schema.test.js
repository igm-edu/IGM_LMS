'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SHEETS } = require('../apps-script/schema');

const EXPECTED_SHEETS = [
  'Users', 'Sessions', 'Classes', 'Enrollments', 'Lessons', 'WatchLogs',
  'Quizzes', 'QuizQuestions', 'QuizAttempts', 'QuizAnswers', 'Attendance',
  'Certificates', 'ErrorLog',
];

test('설계 문서가 정한 13개 시트를 모두 정의한다', () => {
  assert.deepStrictEqual(Object.keys(SHEETS).sort(), EXPECTED_SHEETS.slice().sort());
});

test('시트마다 헤더가 중복 없이 정의되어 있다', () => {
  Object.keys(SHEETS).forEach((name) => {
    const headers = SHEETS[name];
    assert.ok(headers.length > 0, `${name}의 헤더가 비어 있다`);
    assert.strictEqual(
      new Set(headers).size,
      headers.length,
      `${name}에 중복된 헤더가 있다`
    );
  });
});

test('기본키로 쓰기로 한 열이 각 시트의 첫 번째 열이다', () => {
  const primaryKeys = {
    Users: 'user_id',
    Sessions: 'token_hash',
    Classes: 'class_id',
    Enrollments: 'enrollment_id',
    Lessons: 'lesson_id',
    WatchLogs: 'watch_log_id',
    Quizzes: 'quiz_id',
    QuizQuestions: 'question_id',
    QuizAttempts: 'attempt_id',
    QuizAnswers: 'answer_id',
    Attendance: 'attendance_id',
    Certificates: 'certificate_id',
    ErrorLog: 'log_id',
  };
  Object.keys(primaryKeys).forEach((name) => {
    assert.strictEqual(SHEETS[name][0], primaryKeys[name], `${name}의 첫 열이 다르다`);
  });
});

test('개인정보 동의 기록 열이 Users에 있다', () => {
  assert.ok(SHEETS.Users.includes('consent_at'));
  assert.ok(SHEETS.Users.includes('retention_until'));
});

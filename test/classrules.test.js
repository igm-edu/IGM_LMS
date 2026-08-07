'use strict';

const test = require('node:test');
const assert = require('node:assert');
const validate = require('../apps-script/lib/validate');

test('HTTPS 주소만 통과시킨다', () => {
  assert.strictEqual(validate.isHttpsUrl('https://cdn.example.com/a.mp4'), true);
  assert.strictEqual(validate.isHttpsUrl('  https://cdn.example.com/a.mp4  '), true);
  ['http://cdn.example.com/a.mp4', 'ftp://x/a.mp4', '', 'cdn.example.com/a.mp4', 'https://'].forEach((bad) => {
    assert.strictEqual(validate.isHttpsUrl(bad), false, `막아야 함: ${bad}`);
  });
});

test('HTTPS 검사는 값이 없어도 예외를 내지 않는다', () => {
  assert.strictEqual(validate.isHttpsUrl(undefined), false);
  assert.strictEqual(validate.isHttpsUrl(null), false);
});

test('0에서 100 사이의 값만 통과시킨다', () => {
  [0, 50, 100, '80', '0'].forEach((ok) => {
    assert.strictEqual(validate.isPercentInRange(ok), true, `통과해야 함: ${ok}`);
  });
  [-1, 101, 120, 'abc', '', null, undefined, '   '].forEach((bad) => {
    assert.strictEqual(validate.isPercentInRange(bad), false, `막아야 함: ${bad}`);
  });
});

test('클래스 상태는 정해진 셋만 통과시킨다', () => {
  ['모집중', '진행중', '종료'].forEach((ok) => {
    assert.strictEqual(validate.isValidClassStatus(ok), true);
  });
  ['모집 중', '대기', '', 'open', undefined].forEach((bad) => {
    assert.strictEqual(validate.isValidClassStatus(bad), false, `막아야 함: ${bad}`);
  });
});

test('시작일이 종료일보다 늦으면 거부한다', () => {
  assert.strictEqual(validate.isValidDateRange('2026-03-01', '2026-03-31'), true);
  assert.strictEqual(validate.isValidDateRange('2026-03-01', '2026-03-01'), true);
  assert.strictEqual(validate.isValidDateRange('2026-04-01', '2026-03-01'), false);
});

test('날짜가 비어 있으면 통과로 본다', () => {
  // 기간을 정하지 않고 클래스를 먼저 여는 경우가 있다.
  assert.strictEqual(validate.isValidDateRange('', ''), true);
  assert.strictEqual(validate.isValidDateRange('2026-03-01', ''), true);
  assert.strictEqual(validate.isValidDateRange(null, null), true);
});

test('날짜 형식이 깨졌으면 거부한다', () => {
  assert.strictEqual(validate.isValidDateRange('어제', '2026-03-01'), false);
});

test('다음 차시 순서는 가장 큰 값 다음이다', () => {
  assert.strictEqual(validate.nextLessonOrder([]), 1);
  assert.strictEqual(validate.nextLessonOrder([{ lesson_order: 1 }, { lesson_order: 2 }]), 3);
  assert.strictEqual(validate.nextLessonOrder([{ lesson_order: 5 }, { lesson_order: 2 }]), 6);
});

test('순서 값이 깨진 차시는 계산에서 건너뛴다', () => {
  assert.strictEqual(validate.nextLessonOrder([{ lesson_order: '' }, { lesson_order: 3 }]), 4);
  assert.strictEqual(validate.nextLessonOrder([{ lesson_order: 'abc' }]), 1);
});

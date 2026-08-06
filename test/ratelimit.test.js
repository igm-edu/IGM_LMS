'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');

shim.installGlobals();
const ratelimit = require('../apps-script/lib/ratelimit');

function fresh() {
  shim.resetShim();
}

test('처음에는 잠겨 있지 않다', () => {
  fresh();
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false);
});

test('실패를 기록하면 누적 횟수를 돌려준다', () => {
  fresh();
  assert.strictEqual(ratelimit.recordFailure('a@b.com'), 1);
  assert.strictEqual(ratelimit.recordFailure('a@b.com'), 2);
});

test('5회 실패하면 잠긴다', () => {
  fresh();
  for (let i = 0; i < 4; i += 1) ratelimit.recordFailure('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false);
  ratelimit.recordFailure('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true);
});

test('계정마다 따로 센다', () => {
  fresh();
  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true);
  assert.strictEqual(ratelimit.isLocked('c@d.com'), false);
});

test('성공하면 카운터가 지워진다', () => {
  fresh();
  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  ratelimit.clearFailures('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false);
  assert.strictEqual(ratelimit.recordFailure('a@b.com'), 1);
});

test('첫 잠금은 10분 뒤 저절로 풀린다', () => {
  fresh();
  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true);

  shim.advanceClock(9 * 60 * 1000);
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true, '9분 뒤에는 아직 잠겨 있어야 한다');

  shim.advanceClock(2 * 60 * 1000);
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false, '10분이 지나면 풀려야 한다');
});

test('잠금이 풀린 뒤 다시 실패하면 잠금 시간이 길어진다', () => {
  fresh();
  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  shim.advanceClock(11 * 60 * 1000);
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false);

  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true);

  shim.advanceClock(11 * 60 * 1000);
  assert.strictEqual(ratelimit.isLocked('a@b.com'), true, '두 번째 잠금은 10분보다 길어야 한다');

  shim.advanceClock(60 * 60 * 1000);
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false, '1시간이 지나면 풀려야 한다');
});

test('잠금 단계는 마지막 값에서 멈춘다', () => {
  assert.strictEqual(ratelimit.lockSecondsFor_(5), 600);
  assert.strictEqual(ratelimit.lockSecondsFor_(10), 3600);
  assert.strictEqual(ratelimit.lockSecondsFor_(15), 21600);
  assert.strictEqual(ratelimit.lockSecondsFor_(50), 21600);
});

test('성공하면 잠금과 카운터가 모두 지워진다', () => {
  fresh();
  for (let i = 0; i < 5; i += 1) ratelimit.recordFailure('a@b.com');
  ratelimit.clearFailures('a@b.com');
  assert.strictEqual(ratelimit.isLocked('a@b.com'), false);
  assert.strictEqual(ratelimit.recordFailure('a@b.com'), 1, '카운터가 1부터 다시 시작해야 한다');
});

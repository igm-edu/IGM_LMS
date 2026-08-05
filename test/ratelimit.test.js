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

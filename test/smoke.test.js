'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const shim = require('./helpers/gas-shim');

test('셰임의 HMAC-SHA256이 Node 표준 구현과 일치한다', () => {
  const expected = crypto.createHmac('sha256', 'key').update('message').digest();
  const actual = shim.Utilities.computeHmacSha256Signature('message', 'key');
  assert.deepStrictEqual(actual, shim.toSigned(expected));
});

test('newBlob이 UTF-8 바이트를 반환한다', () => {
  const bytes = shim.Utilities.newBlob('가').getBytes();
  assert.deepStrictEqual(shim.toBuffer(bytes), Buffer.from('가', 'utf8'));
});

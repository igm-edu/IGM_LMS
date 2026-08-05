'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const shim = require('./helpers/gas-shim');

shim.installGlobals();
const hash = require('../apps-script/lib/hash');

test('PBKDF2 구현이 Node 표준 구현과 같은 값을 낸다', () => {
  const password = 'correct horse battery staple';
  const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const expected = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');

  const actual = hash.bytesToHex_(
    hash.pbkdf2Sha256_(hash.strToBytes_(password), shim.toSigned(salt), 1000)
  );

  assert.strictEqual(actual, expected);
});

test('한글 비밀번호도 UTF-8 기준으로 표준과 일치한다', () => {
  const password = '비밀번호1234';
  const salt = Buffer.from('ffffffffffffffffffffffffffffffff', 'hex');
  const expected = crypto.pbkdf2Sync(password, salt, 200, 32, 'sha256').toString('hex');

  const actual = hash.bytesToHex_(
    hash.pbkdf2Sha256_(hash.strToBytes_(password), shim.toSigned(salt), 200)
  );

  assert.strictEqual(actual, expected);
});

test('해시 형식이 pbkdf2$반복횟수$salt$해시 네 부분으로 구성된다', () => {
  const stored = hash.hashPassword('테스트비밀번호', 100);
  const parts = stored.split('$');
  assert.strictEqual(parts.length, 4);
  assert.strictEqual(parts[0], 'pbkdf2');
  assert.strictEqual(parts[1], '100');
  assert.strictEqual(parts[2].length, 32);
  assert.strictEqual(parts[3].length, 64);
});

test('같은 비밀번호라도 매번 다른 해시가 나온다', () => {
  const a = hash.hashPassword('같은비밀번호', 100);
  const b = hash.hashPassword('같은비밀번호', 100);
  assert.notStrictEqual(a, b);
});

test('올바른 비밀번호는 검증을 통과한다', () => {
  const stored = hash.hashPassword('올바른비밀번호', 100);
  assert.strictEqual(hash.verifyPassword('올바른비밀번호', stored), true);
});

test('틀린 비밀번호는 검증에 실패한다', () => {
  const stored = hash.hashPassword('올바른비밀번호', 100);
  assert.strictEqual(hash.verifyPassword('틀린비밀번호', stored), false);
});

test('반복 횟수를 바꿔도 기존 해시는 그대로 검증된다', () => {
  const stored = hash.hashPassword('비밀번호', 100);
  assert.strictEqual(hash.verifyPassword('비밀번호', stored), true);
  const rehashed = hash.hashPassword('비밀번호', 500);
  assert.strictEqual(hash.verifyPassword('비밀번호', rehashed), true);
});

test('형식이 망가진 저장값은 예외 없이 false를 반환한다', () => {
  ['', 'garbage', 'pbkdf2$100$abc', 'bcrypt$100$aa$bb'].forEach((bad) => {
    assert.strictEqual(hash.verifyPassword('비밀번호', bad), false, `입력: ${bad}`);
  });
});

test('세션 토큰은 64자 16진 문자열이며 매번 다르다', () => {
  const a = hash.generateToken();
  const b = hash.generateToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a, b);
});

test('sha256Hex가 Node 표준 SHA-256과 일치한다', () => {
  const expected = crypto.createHash('sha256').update('토큰값').digest('hex');
  assert.strictEqual(hash.sha256Hex('토큰값'), expected);
});

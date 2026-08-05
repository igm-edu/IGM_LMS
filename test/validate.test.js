'use strict';

const test = require('node:test');
const assert = require('node:assert');

const errors = require('../apps-script/lib/errors');
const validate = require('../apps-script/lib/validate');

test('appError_는 코드가 붙은 Error를 만든다', () => {
  const err = errors.appError_('BAD_REQUEST', '잘못된 요청입니다.');
  assert.ok(err instanceof Error);
  assert.strictEqual(err.appCode, 'BAD_REQUEST');
  assert.strictEqual(err.message, '잘못된 요청입니다.');
  assert.strictEqual(errors.isAppError_(err), true);
});

test('isAppError_는 일반 예외를 구분한다', () => {
  assert.strictEqual(errors.isAppError_(new Error('그냥 버그')), false);
  assert.strictEqual(errors.isAppError_(null), false);
  assert.strictEqual(errors.isAppError_(undefined), false);
});

test('normalizeEmail은 공백을 제거하고 소문자로 바꾼다', () => {
  assert.strictEqual(validate.normalizeEmail('  Hong@IGM.co.KR '), 'hong@igm.co.kr');
  assert.strictEqual(validate.normalizeEmail('a@b.com'), 'a@b.com');
});

test('normalizeEmail은 값이 없어도 빈 문자열을 돌려준다', () => {
  assert.strictEqual(validate.normalizeEmail(undefined), '');
  assert.strictEqual(validate.normalizeEmail(null), '');
});

test('대소문자만 다른 주소는 같은 값으로 정규화된다', () => {
  assert.strictEqual(
    validate.normalizeEmail('Hong@igm.co.kr'),
    validate.normalizeEmail('hong@IGM.co.kr')
  );
});

test('isValidEmail은 형식을 검사한다', () => {
  ['a@b.com', 'hong.gil@igm.co.kr', ' A@B.CO '].forEach((ok) => {
    assert.strictEqual(validate.isValidEmail(ok), true, `통과해야 함: ${ok}`);
  });
  ['', 'abc', 'a@b', 'a b@c.com', '@b.com', 'a@.com'].forEach((bad) => {
    assert.strictEqual(validate.isValidEmail(bad), false, `막아야 함: ${bad}`);
  });
});

test('비밀번호는 8자 이상이어야 한다', () => {
  assert.match(validate.validatePassword('abc1234'), /8자/);
  assert.strictEqual(validate.validatePassword('abcd1234'), null);
});

test('비밀번호는 영문과 숫자를 모두 포함해야 한다', () => {
  assert.match(validate.validatePassword('12345678'), /영문/);
  assert.match(validate.validatePassword('abcdefgh'), /숫자/);
  assert.strictEqual(validate.validatePassword('a1234567'), null);
});

test('비밀번호가 없으면 길이 사유로 거부한다', () => {
  assert.match(validate.validatePassword(undefined), /8자/);
  assert.match(validate.validatePassword(''), /8자/);
});

test('requireFields는 비어 있는 항목 이름을 모아 돌려준다', () => {
  const payload = { name: '홍길동', email: '', phone: '   ', company: '아이지엠' };
  assert.deepStrictEqual(
    validate.requireFields(payload, ['name', 'email', 'phone', 'company', 'position']),
    ['email', 'phone', 'position']
  );
});

test('requireFields는 모두 채워져 있으면 빈 배열을 돌려준다', () => {
  assert.deepStrictEqual(validate.requireFields({ a: '1', b: '2' }, ['a', 'b']), []);
});

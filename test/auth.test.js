'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const auth = require('../apps-script/handlers/auth');

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
}

function signupPayload(overrides) {
  const base = {
    name: '홍길동',
    email: 'Hong@IGM.co.kr',
    password: 'abcd1234',
    phone: '010-1234-5678',
    company: '아이지엠',
    position: '팀장',
    birth_date: '1985-03-02',
    consent: true,
  };
  return Object.assign(base, overrides || {});
}

test('publicUser_는 비밀번호 해시를 절대 포함하지 않는다', () => {
  const row = {
    user_id: 'U1', name: '홍길동', email: 'a@b.com',
    password_hash: 'pbkdf2$3000$aaaa$bbbb',
    phone: '010', company: '회사', position: '직급', birth_date: '1985-03-02',
    role: 'student', status: 'active',
    consent_at: new Date(), retention_until: new Date(), created_at: new Date(),
  };
  const out = auth.publicUser_(row);
  assert.strictEqual(out.password_hash, undefined);
  assert.strictEqual(JSON.stringify(out).indexOf('pbkdf2'), -1);
});

test('publicUser_는 생년월일과 동의 기록도 내보내지 않는다', () => {
  const out = auth.publicUser_({
    user_id: 'U1', birth_date: '1985-03-02',
    consent_at: 'x', retention_until: 'y', password_hash: 'z',
  });
  assert.strictEqual(out.birth_date, undefined);
  assert.strictEqual(out.consent_at, undefined);
  assert.strictEqual(out.retention_until, undefined);
});

test('publicUser_는 시트에 열이 추가되어도 그대로 흘려보내지 않는다', () => {
  const out = auth.publicUser_({ user_id: 'U1', 나중에추가된열: '비밀' });
  assert.strictEqual(out['나중에추가된열'], undefined);
});

test('가입하면 계정이 만들어지고 토큰이 함께 발급된다', () => {
  fresh();
  const result = auth.handleSignup(signupPayload());

  assert.ok(result.token, '토큰이 발급되어야 한다');
  assert.strictEqual(result.user.name, '홍길동');
  assert.strictEqual(result.user.role, 'student');
  assert.strictEqual(result.user.password_hash, undefined);
  assert.strictEqual(sheet.readAll('Sessions').length, 1);
});

test('가입 시 이메일은 소문자로 저장된다', () => {
  fresh();
  const result = auth.handleSignup(signupPayload());
  assert.strictEqual(result.user.email, 'hong@igm.co.kr');
  assert.ok(sheet.findByColumn('Users', 'email', 'hong@igm.co.kr'));
});

test('대소문자만 다른 이메일로는 중복 가입할 수 없다', () => {
  fresh();
  auth.handleSignup(signupPayload({ email: 'hong@igm.co.kr' }));
  assert.throws(() => auth.handleSignup(signupPayload({ email: 'HONG@IGM.CO.KR' })), (err) => {
    assert.strictEqual(err.appCode, 'EMAIL_TAKEN');
    return true;
  });
  assert.strictEqual(sheet.readAll('Users').length, 1);
});

test('필수 항목이 비면 무엇이 빠졌는지 알려주며 거부한다', () => {
  fresh();
  assert.throws(() => auth.handleSignup(signupPayload({ company: '' })), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /company/);
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('동의하지 않으면 가입되지 않는다', () => {
  fresh();
  [false, undefined, 'true'].forEach((value) => {
    assert.throws(() => auth.handleSignup(signupPayload({ consent: value })), (err) => {
      assert.strictEqual(err.appCode, 'BAD_REQUEST');
      return true;
    });
  });
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('비밀번호 정책과 이메일 형식을 검사한다', () => {
  fresh();
  assert.throws(() => auth.handleSignup(signupPayload({ password: 'abcdefgh' })), /숫자/);
  assert.throws(() => auth.handleSignup(signupPayload({ email: '이상한주소' })), /이메일 형식/);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('가입 시 동의 시각과 보관 만료일이 기록된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const row = sheet.findByColumn('Users', 'email', 'hong@igm.co.kr');
  assert.ok(row.consent_at, '동의 시각이 있어야 한다');
  const created = new Date(row.created_at);
  const retention = new Date(row.retention_until);
  assert.strictEqual(retention.getFullYear() - created.getFullYear(), 3);
});

test('비밀번호는 해시로만 저장된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const row = sheet.findByColumn('Users', 'email', 'hong@igm.co.kr');
  assert.match(row.password_hash, /^pbkdf2\$/);
  assert.strictEqual(String(row.password_hash).indexOf('abcd1234'), -1);
});

test('가입한 계정으로 로그인된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const result = auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' });
  assert.ok(result.token);
  assert.strictEqual(result.user.email, 'hong@igm.co.kr');
  assert.strictEqual(result.user.password_hash, undefined);
});

test('대문자로 입력해도 로그인된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  assert.ok(auth.handleLogin({ email: '  HONG@IGM.co.kr ', password: 'abcd1234' }).token);
});

test('없는 이메일과 틀린 비밀번호가 같은 응답을 준다', () => {
  fresh();
  auth.handleSignup(signupPayload());

  const errors = [];
  [
    { email: 'nobody@igm.co.kr', password: 'abcd1234' },
    { email: 'hong@igm.co.kr', password: 'wrongpass1' },
  ].forEach((payload) => {
    try {
      auth.handleLogin(payload);
      assert.fail('로그인이 실패해야 한다');
    } catch (err) {
      errors.push({ code: err.appCode, message: err.message });
    }
  });

  assert.strictEqual(errors[0].code, 'INVALID_CREDENTIALS');
  assert.deepStrictEqual(errors[0], errors[1], '두 경우의 응답이 달라서는 안 된다');
});

test('5회 실패하면 잠기고, 잠긴 뒤에는 비밀번호가 맞아도 거부된다', () => {
  fresh();
  auth.handleSignup(signupPayload());

  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'wrongpass1' }));
  }

  assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' }), (err) => {
    assert.strictEqual(err.appCode, 'ACCOUNT_LOCKED');
    return true;
  });
});

test('로그인에 성공하면 실패 카운터가 지워진다', () => {
  fresh();
  auth.handleSignup(signupPayload());

  for (let i = 0; i < 4; i += 1) {
    assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'wrongpass1' }));
  }
  assert.ok(auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' }).token);

  for (let i = 0; i < 4; i += 1) {
    assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'wrongpass1' }));
  }
  assert.ok(auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' }).token);
});

test('비활성 계정은 로그인할 수 없다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  sheet.update('Users', created.user.user_id, { status: 'inactive' });

  assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' }), (err) => {
    assert.strictEqual(err.appCode, 'ACCOUNT_INACTIVE');
    return true;
  });
});

test('저장된 해시가 손상되어도 그 계정만 실패하고 예외가 새지 않는다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  sheet.update('Users', created.user.user_id, { password_hash: '깨진값' });

  assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'abcd1234' }), (err) => {
    assert.strictEqual(err.appCode, 'INVALID_CREDENTIALS');
    return true;
  });
});

// 시트는 관리자가 손으로 편집한다. 아래 네 가지는 그렇게 만들어진 행이
// 로그인·중복검사에서 어떻게 취급되는지를 고정한다.

test('시트에 대문자로 저장된 이메일도 로그인된다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  sheet.update('Users', created.user.user_id, { email: 'Park@IGM.co.kr' });

  assert.ok(auth.handleLogin({ email: 'park@igm.co.kr', password: 'abcd1234' }).token);
});

test('시트에 앞뒤 공백이 있는 이메일도 로그인된다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  sheet.update('Users', created.user.user_id, { email: '  lee@igm.co.kr  ' });

  assert.ok(auth.handleLogin({ email: 'lee@igm.co.kr', password: 'abcd1234' }).token);
});

test('시트에 대문자로 적힌 이메일도 가입 중복으로 잡는다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  sheet.update('Users', created.user.user_id, { email: 'Kim@IGM.co.kr' });

  assert.throws(() => auth.handleSignup(signupPayload({ email: 'kim@igm.co.kr' })), (err) => {
    assert.strictEqual(err.appCode, 'EMAIL_TAKEN');
    return true;
  });
  assert.strictEqual(sheet.readAll('Users').length, 1);
});

/** 정규화 없이 중복 검사가 돌던 시절에 생긴 "한 이메일에 두 행" 상태를 만든다. */
function seedDuplicateEmailRows() {
  const first = auth.handleSignup(signupPayload({ email: 'dup@igm.co.kr', password: 'first1234' }));
  const second = auth.handleSignup(signupPayload({ email: 'other@igm.co.kr', password: 'second1234' }));
  sheet.update('Users', second.user.user_id, { email: 'Dup@IGM.co.kr' });
  return { first, second };
}

test('같은 이메일 행이 둘이면 각자의 비밀번호로 둘 다 로그인된다', () => {
  fresh();
  const { first, second } = seedDuplicateEmailRows();

  assert.strictEqual(
    auth.handleLogin({ email: 'dup@igm.co.kr', password: 'first1234' }).user.user_id,
    first.user.user_id
  );
  // 첫 행만 보던 시절에는 이 사람이 영구히 잠겼다.
  assert.strictEqual(
    auth.handleLogin({ email: 'dup@igm.co.kr', password: 'second1234' }).user.user_id,
    second.user.user_id
  );
});

test('같은 이메일 행이 둘이면 관리자가 찾을 수 있게 기록을 남긴다', () => {
  fresh();
  seedDuplicateEmailRows();

  const original = global.logError_;
  const logged = [];
  global.logError_ = function (action, userId, err) {
    logged.push({ action: action, message: err && err.message });
  };

  try {
    auth.handleLogin({ email: 'dup@igm.co.kr', password: 'first1234' });
  } finally {
    global.logError_ = original;
  }

  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0].action, 'auth.login');
  assert.match(logged[0].message, /2개/);
  assert.match(logged[0].message, /dup@igm\.co\.kr/);
});

test('이름이 같고 이메일이 다르면 각자 로그인된다', () => {
  fresh();
  const emails = ['kim1@igm.co.kr', 'kim2@igm.co.kr', 'kim3@igm.co.kr'];
  emails.forEach((email) => {
    auth.handleSignup(signupPayload({ name: '김철수', email: email }));
  });

  emails.forEach((email) => {
    assert.strictEqual(auth.handleLogin({ email: email, password: 'abcd1234' }).user.email, email);
  });
});

test('이메일이나 비밀번호가 비면 BAD_REQUEST', () => {
  fresh();
  assert.throws(() => auth.handleLogin({ email: '', password: 'abcd1234' }), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    return true;
  });
  assert.throws(() => auth.handleLogin({ email: 'a@b.com', password: '' }), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    return true;
  });
});

test('잠긴 계정에 더 시도해도 실패 카운터를 늘리지 않는다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'wrongpass1' }));
  }

  const original = global.recordFailure;
  let calls = 0;
  global.recordFailure = function (key) { calls += 1; return original(key); };

  try {
    for (let i = 0; i < 3; i += 1) {
      assert.throws(() => auth.handleLogin({ email: 'hong@igm.co.kr', password: 'wrongpass1' }), (err) => {
        assert.strictEqual(err.appCode, 'ACCOUNT_LOCKED');
        return true;
      });
    }
  } finally {
    global.recordFailure = original;
  }

  assert.strictEqual(calls, 0,
    '잠긴 뒤의 시도는 카운터를 늘리지 않아야 한다. 늘리면 잠금 만료가 계속 미뤄져 정당한 사용자가 영구 차단된다.');
});

test('handleMe는 토큰의 사용자를 돌려주고 해시를 포함하지 않는다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);

  const out = auth.handleMe({}, user);
  assert.strictEqual(out.user_id, created.user.user_id);
  assert.strictEqual(out.password_hash, undefined);
});

test('프로필 수정은 허용된 필드만 바꾼다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);

  const out = auth.handleUpdateProfile(
    { name: '김철수', phone: '010-9999-8888', company: '새회사', position: '이사', birth_date: '1990-01-01' },
    user
  );

  assert.strictEqual(out.name, '김철수');
  assert.strictEqual(out.company, '새회사');
  const row = sheet.findByPk('Users', created.user.user_id);
  assert.strictEqual(row.phone, '010-9999-8888');
  assert.strictEqual(row.birth_date, '1990-01-01');
});

test('프로필 수정으로 역할·상태·이메일·해시를 바꿀 수 없다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);
  const before = sheet.findByPk('Users', created.user.user_id);

  auth.handleUpdateProfile({
    name: '김철수',
    role: 'admin',
    status: 'inactive',
    email: 'attacker@evil.com',
    password_hash: '바꿔치기',
  }, user);

  const after = sheet.findByPk('Users', created.user.user_id);
  assert.strictEqual(after.role, 'student');
  assert.strictEqual(after.status, 'active');
  assert.strictEqual(after.email, 'hong@igm.co.kr');
  assert.strictEqual(after.password_hash, before.password_hash);
  assert.strictEqual(after.name, '김철수');
});

test('프로필 수정은 요청 본문의 user_id를 무시하고 토큰의 사용자만 고친다', () => {
  fresh();
  const mine = auth.handleSignup(signupPayload());
  const other = auth.handleSignup(signupPayload({ email: 'other@igm.co.kr', name: '남의계정' }));
  const user = sheet.findByPk('Users', mine.user.user_id);

  auth.handleUpdateProfile({ user_id: other.user.user_id, name: '바뀐이름' }, user);

  assert.strictEqual(sheet.findByPk('Users', mine.user.user_id).name, '바뀐이름');
  assert.strictEqual(sheet.findByPk('Users', other.user.user_id).name, '남의계정');
});

test('로그아웃하면 세션이 사라진다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);
  assert.strictEqual(sheet.readAll('Sessions').length, 1);

  auth.handleLogout({ _token: created.token }, user);

  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
});

test('필수 항목을 비우려는 수정은 오류로 거부한다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);

  assert.throws(() => auth.handleUpdateProfile({ phone: '' }, user), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /phone/);
    return true;
  });

  assert.strictEqual(sheet.findByPk('Users', created.user.user_id).phone, '010-1234-5678');
});

test('공백만 보내거나 null을 보내도 비우려는 시도로 본다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);

  assert.throws(() => auth.handleUpdateProfile({ company: '   ' }, user), /비울 수 없는/);
  assert.throws(() => auth.handleUpdateProfile({ company: null }, user), /비울 수 없는/);
  assert.strictEqual(sheet.findByPk('Users', created.user.user_id).company, '아이지엠');
});

test('보내지 않은 항목은 그대로 유지된다', () => {
  fresh();
  const created = auth.handleSignup(signupPayload());
  const user = sheet.findByPk('Users', created.user.user_id);

  auth.handleUpdateProfile({ name: '김철수' }, user);

  const row = sheet.findByPk('Users', created.user.user_id);
  assert.strictEqual(row.name, '김철수');
  assert.strictEqual(row.phone, '010-1234-5678');
  assert.strictEqual(row.company, '아이지엠');
});

test('가입은 중복 확인과 저장을 잠금으로 감싼다', () => {
  fresh();
  const before = shim.lockStats();
  auth.handleSignup(signupPayload());
  const after = shim.lockStats();

  assert.strictEqual(after.waits - before.waits, 1, '잠금을 획득해야 한다');
  assert.strictEqual(after.releases - before.releases, 1, '잠금을 반드시 반납해야 한다');
});

test('중복 이메일로 실패해도 잠금은 반납된다', () => {
  fresh();
  auth.handleSignup(signupPayload());
  const before = shim.lockStats();

  assert.throws(() => auth.handleSignup(signupPayload()), (err) => {
    assert.strictEqual(err.appCode, 'EMAIL_TAKEN');
    return true;
  });

  const after = shim.lockStats();
  assert.strictEqual(after.releases - before.releases, 1, '실패 경로에서도 반납해야 한다');
});

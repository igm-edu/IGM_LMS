# 인증 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doPost`로 들어온 요청이 라우팅·권한 검사를 거쳐 회원가입·로그인·로그아웃·내 정보 조회·프로필 수정을 처리하고, 가입부터 로그인까지의 전 과정이 Node 통합 테스트로 검증되는 상태를 만든다.

**Architecture:** 단일 엔드포인트에 POST하고 본문의 `action`으로 분기한다. 권한 요구사항은 라우팅 표에 선언하고 진입 지점에서 일괄 검사한다. 예상된 실패는 코드를 붙여 던지고 그 외 예외만 ErrorLog에 기록한다. Sheets에 의존하지 않는 판정 로직은 별도 파일로 분리해 Node에서 단위 테스트한다.

**Tech Stack:** Google Apps Script (V8), clasp, Node.js 내장 테스트 러너(`node:test`), 의존성 없음

설계 문서: `docs/superpowers/specs/2026-08-05-auth-design.md`

## Global Constraints

- Apps Script 코드는 `var` 선언 스타일을 쓴다. clasp가 올리는 `.js` 파일은 전역 스코프에서 이어 붙여지므로 `import`/`export` 구문을 쓸 수 없고, 화살표 함수를 쓰지 않는다.
- Node 호환은 각 파일 끝의 `if (typeof module !== 'undefined') { ... }` 블록으로 처리한다. 다른 파일의 함수를 쓰려면 이 블록 안에서 `global.X = require(...)` 형태로 주입한다. **`var X = require(...)`로 선언하면 Apps Script에서 같은 이름을 다시 선언하게 되어 파일 로드 순서에 의존하는 구조가 된다.** 기존 `lib/sheet.js`와 `setup.js`가 이 패턴을 쓰고 있으니 그대로 따른다.
- 시트 이름과 헤더는 `apps-script/schema.js`의 `SHEETS`가 유일한 출처다.
- 외부 npm 의존성을 추가하지 않는다. 테스트는 Node 내장 기능만 쓴다.
- 비밀번호 정책은 8자 이상이며 영문과 숫자를 모두 포함해야 한다.
- 이메일은 저장·조회·중복검사 모두 `normalizeEmail`을 거친 값을 쓴다(앞뒤 공백 제거 후 소문자).
- 로그인 실패 응답은 이메일 존재 여부를 노출하지 않는다. 없는 이메일과 틀린 비밀번호가 같은 코드·같은 메시지를 반환한다.
- 사용자 정보를 응답에 담을 때는 반드시 `publicUser_`를 거친다. `password_hash`는 어떤 응답에도 포함되지 않는다.
- 세션 유효기간은 24시간, 만료 6시간 이내에만 연장한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps-script/lib/errors.js` | 오류 코드 상수, `appError_`, `isAppError_` |
| `apps-script/lib/validate.js` | 이메일 정규화·형식 검사, 비밀번호 정책, 필수 항목 검사 |
| `apps-script/lib/sheet.js` | (수정) `findByColumn` 추가 |
| `apps-script/lib/ratelimit.js` | 로그인 시도 카운터 |
| `apps-script/lib/session.js` | 토큰 발급·검증·연장·폐기 |
| `apps-script/handlers/auth.js` | `publicUser_`, 가입·로그인·로그아웃·내정보·프로필수정 |
| `apps-script/main.js` | `doGet`/`doPost`, 라우팅 표, 권한 검사, 오류 응답, ErrorLog 기록 |
| `apps-script/setup.js` | (수정) `RETENTION_YEARS`를 export에 추가 |
| `test/helpers/gas-shim.js` | (수정) `ContentService` 대역 추가 |
| `test/validate.test.js` | 검증 유틸 단위 테스트 |
| `test/session.test.js` | 세션 단위 테스트 |
| `test/ratelimit.test.js` | 시도 제한 단위 테스트 |
| `test/auth.test.js` | 핸들러 단위 테스트 |
| `test/api.test.js` | `doPost` 통합 테스트 |

---

### Task 1: 오류 타입과 검증 유틸

핸들러들이 공통으로 쓰는 오류 생성기와 순수 검증 함수를 만든다. Sheets에 의존하지 않으므로 가장 먼저 만들고 단독으로 테스트한다.

**Files:**
- Create: `apps-script/lib/errors.js`
- Create: `apps-script/lib/validate.js`
- Test: `test/validate.test.js`

**Interfaces:**
- Produces (errors.js): `appError_(code, message) -> Error` — `appCode` 속성이 붙은 Error. `isAppError_(err) -> boolean`. 상수 `ERROR_CODES` (객체).
- Produces (validate.js): `normalizeEmail(value) -> string`, `isValidEmail(value) -> boolean`, `validatePassword(value) -> string | null` (null이면 통과, 아니면 사용자에게 보여줄 사유), `requireFields(payload, fields) -> string[]` (비어 있는 항목 이름 목록).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/validate.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/lib/errors'`

- [ ] **Step 3: `apps-script/lib/errors.js` 구현**

```js
/**
 * 예상된 실패와 예기치 못한 예외를 구분하기 위한 오류 타입.
 * appCode가 붙은 예외는 사용자에게 그대로 전달되고 ErrorLog에 기록하지 않는다.
 * 그 외 예외만 ErrorLog에 남긴다. 구분하지 않으면 정상적인 로그인 실패가
 * 로그를 채워 진짜 버그를 묻어버린다.
 */
var ERROR_CODES = {
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
};

function appError_(code, message) {
  var err = new Error(message);
  err.appCode = code;
  return err;
}

function isAppError_(err) {
  return !!(err && err.appCode);
}

if (typeof module !== 'undefined') {
  module.exports = {
    ERROR_CODES: ERROR_CODES,
    appError_: appError_,
    isAppError_: isAppError_,
  };
}
```

- [ ] **Step 4: `apps-script/lib/validate.js` 구현**

```js
/**
 * 순수 검증 로직. Sheets나 Apps Script API에 의존하지 않는다.
 */

var PASSWORD_MIN_LENGTH = 8;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 이메일을 저장·조회에 쓸 표준형으로 바꾼다.
 * 정규화하지 않으면 Hong@igm.co.kr로 가입한 사람이 소문자로 로그인할 때 실패하고,
 * 중복 검사가 대소문자만 다른 주소를 다른 것으로 판정해 계정이 둘 생긴다.
 */
function normalizeEmail(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

/** 통과하면 null, 아니면 사용자에게 보여줄 사유 문자열을 돌려준다. */
function validatePassword(value) {
  var password = value === undefined || value === null ? '' : String(value);
  if (password.length < PASSWORD_MIN_LENGTH) {
    return '비밀번호는 ' + PASSWORD_MIN_LENGTH + '자 이상이어야 합니다.';
  }
  if (!/[A-Za-z]/.test(password)) {
    return '비밀번호에 영문자를 포함해야 합니다.';
  }
  if (!/[0-9]/.test(password)) {
    return '비밀번호에 숫자를 포함해야 합니다.';
  }
  return null;
}

/** 비어 있는 필수 항목의 이름 목록을 돌려준다. */
function requireFields(payload, fields) {
  var missing = [];
  var source = payload || {};
  for (var i = 0; i < fields.length; i++) {
    var value = source[fields[i]];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(fields[i]);
    }
  }
  return missing;
}

if (typeof module !== 'undefined') {
  module.exports = {
    PASSWORD_MIN_LENGTH: PASSWORD_MIN_LENGTH,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    validatePassword: validatePassword,
    requireFields: requireFields,
  };
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 63 tests pass (기존 52 + 신규 11)

- [ ] **Step 6: 커밋**

```bash
git add apps-script/lib/errors.js apps-script/lib/validate.js test/validate.test.js
git commit -m "feat: 오류 타입과 인증 검증 유틸"
```

---

### Task 2: `findByColumn` 추가

이메일처럼 기본키가 아닌 열로 조회할 때 시트 전체를 읽지 않도록, 지정한 열 하나만 읽는 조회를 추가한다.

**Files:**
- Modify: `apps-script/lib/sheet.js`
- Test: `test/sheet.test.js`

**Interfaces:**
- Consumes: 기존 `headersOf_`, `getSheet_`, `rowToObject_` (같은 파일 안)
- Produces: `findByColumn(name, field, value) -> object | null` — 일치하는 첫 행을 객체로. 없으면 `null`. 정의되지 않은 열 이름이면 예외.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/sheet.test.js` 끝에 추가한다. 파일 상단의 `freshSpreadsheet()` 헬퍼를 그대로 쓴다.

```js
test('findByColumn은 기본키가 아닌 열로 레코드를 찾는다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째', email: 'a@b.com' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째', email: 'c@d.com' });

  const found = sheet.findByColumn('Users', 'email', 'c@d.com');
  assert.strictEqual(found.user_id, 'U2');
  assert.strictEqual(found.name, '둘째');
});

test('findByColumn은 찾지 못하면 null을 돌려준다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', email: 'a@b.com' });
  assert.strictEqual(sheet.findByColumn('Users', 'email', 'x@y.com'), null);
});

test('findByColumn은 헤더만 있는 시트에서도 null을 돌려준다', () => {
  freshSpreadsheet();
  assert.strictEqual(sheet.findByColumn('Users', 'email', 'a@b.com'), null);
});

test('findByColumn은 값이 여럿이면 가장 위의 행을 돌려준다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '위', email: 'same@b.com' });
  sheet.insert('Users', { user_id: 'U2', name: '아래', email: 'same@b.com' });
  assert.strictEqual(sheet.findByColumn('Users', 'email', 'same@b.com').name, '위');
});

test('findByColumn은 정의되지 않은 열 이름을 거부한다', () => {
  freshSpreadsheet();
  assert.throws(() => sheet.findByColumn('Users', '없는열', 'x'), /정의되지 않은 열/);
});

test('findByColumn은 시트 전체가 아니라 해당 열만 읽는다', () => {
  const { users } = freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', email: 'a@b.com' });

  const widths = [];
  const original = users.getRange;
  users.getRange = function (row, col, numRows, numCols) {
    widths.push(numCols === undefined ? 1 : numCols);
    return original.call(users, row, col, numRows, numCols);
  };

  try {
    sheet.findByColumn('Users', 'email', 'a@b.com');
  } finally {
    users.getRange = original;
  }

  // 첫 호출은 열 하나만 훑는 스캔이어야 한다. 전체 폭을 읽으면 이 검사가 깨진다.
  assert.strictEqual(widths[0], 1);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `sheet.findByColumn is not a function`

- [ ] **Step 3: 구현**

`apps-script/lib/sheet.js`의 `findBy` 바로 아래에 추가한다.

```js
/**
 * 기본키가 아닌 열로 레코드를 찾는다.
 * readAll이 시트 전체를 읽는 것과 달리 해당 열 하나만 훑어 행 번호를 찾고
 * 그 행만 다시 읽는다. 호출은 두 번이지만 각 payload가 훨씬 작다.
 * 일치하는 행이 여럿이면 가장 위의 행을 돌려준다.
 */
function findByColumn(name, field, value) {
  var headers = headersOf_(name);
  var columnIndex = headers.indexOf(field);
  if (columnIndex === -1) {
    throw new Error('정의되지 않은 열입니다: ' + name + '.' + field);
  }

  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var column = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues();
  var target = String(value);
  for (var i = 0; i < column.length; i++) {
    if (String(column[i][0]) === target) {
      var row = sheet.getRange(i + 2, 1, 1, headers.length).getValues()[0];
      return rowToObject_(headers, row);
    }
  }
  return null;
}
```

`module.exports` 블록에 `findByColumn: findByColumn,`을 추가한다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 69 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/lib/sheet.js test/sheet.test.js
git commit -m "feat: 열 하나만 읽는 findByColumn 추가"
```

---

### Task 3: 로그인 시도 제한

같은 계정에 연속 실패가 쌓이면 잠근다. 잠긴 동안의 시도는 카운터를 늘리지 않는다.

**Files:**
- Create: `apps-script/lib/ratelimit.js`
- Test: `test/ratelimit.test.js`

**Interfaces:**
- Consumes: 전역 `CacheService`
- Produces: `isLocked(key) -> boolean`, `recordFailure(key) -> number` (누적 실패 횟수), `clearFailures(key) -> void`. 상수 `LOGIN_MAX_FAILURES` (5), `LOGIN_LOCK_SECONDS` (600).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/ratelimit.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/lib/ratelimit'`

- [ ] **Step 3: 구현**

`apps-script/lib/ratelimit.js`:

```js
/**
 * 로그인 시도 제한. Apps Script는 접속자 IP를 알 수 없어 계정 기준으로만 센다.
 * 카운터는 CacheService에 두며 잠금 시간과 같은 만료를 준다.
 */

var LOGIN_MAX_FAILURES = 5;
var LOGIN_LOCK_SECONDS = 600;

function failureKey_(key) {
  return 'loginfail:' + key;
}

function isLocked(key) {
  var raw = CacheService.getScriptCache().get(failureKey_(key));
  if (raw === null) return false;
  return parseInt(raw, 10) >= LOGIN_MAX_FAILURES;
}

function recordFailure(key) {
  var cache = CacheService.getScriptCache();
  var cacheKey = failureKey_(key);
  var raw = cache.get(cacheKey);
  var count = (raw === null ? 0 : parseInt(raw, 10)) + 1;
  cache.put(cacheKey, String(count), LOGIN_LOCK_SECONDS);
  return count;
}

function clearFailures(key) {
  CacheService.getScriptCache().remove(failureKey_(key));
}

if (typeof module !== 'undefined') {
  module.exports = {
    LOGIN_MAX_FAILURES: LOGIN_MAX_FAILURES,
    LOGIN_LOCK_SECONDS: LOGIN_LOCK_SECONDS,
    isLocked: isLocked,
    recordFailure: recordFailure,
    clearFailures: clearFailures,
  };
}
```

주의: 테스트 대역의 `CacheService.put`은 만료 인자를 무시한다. 따라서 "10분 뒤 자동 해제"는 이 테스트로 검증되지 않는다. 실제 만료는 Apps Script 런타임이 처리하며, 이 한계는 기록해 둔다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 74 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/lib/ratelimit.js test/ratelimit.test.js
git commit -m "feat: 로그인 시도 제한 카운터"
```

---

### Task 4: 세션

토큰 발급·검증·연장·폐기를 만든다. 만료와 연장 판정은 시각을 인자로 받는 순수 함수로 분리해 경계값을 직접 검증한다.

**Files:**
- Create: `apps-script/lib/session.js`
- Test: `test/session.test.js`

**Interfaces:**
- Consumes: `generateToken`, `sha256Hex` (lib/hash.js), `insert`, `findByPk`, `update`, `deleteByPk` (lib/sheet.js), `appError_` (lib/errors.js)
- Produces:
  - `issueSession(userId, now?) -> string` — 토큰 원문. 시트에는 해시만 저장한다.
  - `verifySession(token, now?) -> object` — Users 레코드. 실패하면 `appError_`를 던진다.
  - `revokeSession(token) -> boolean`
  - `sessionStatus_(expiresAt, now) -> 'expired' | 'renew' | 'valid'` — 순수 판정
  - 상수 `SESSION_HOURS` (24), `SESSION_RENEW_WITHIN_HOURS` (6)

- [ ] **Step 1: 실패하는 테스트 작성**

`test/session.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const session = require('../apps-script/lib/session');

const HOUR = 60 * 60 * 1000;

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Users', {
    user_id: 'U1', name: '홍길동', email: 'hong@igm.co.kr',
    role: 'student', status: 'active',
  });
}

test('sessionStatus_는 만료·연장·유효를 구분한다', () => {
  const now = new Date('2026-08-05T12:00:00Z');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() - 1), now), 'expired');
  assert.strictEqual(session.sessionStatus_(now, now), 'expired');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 5 * HOUR), now), 'renew');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 6 * HOUR), now), 'renew');
  assert.strictEqual(session.sessionStatus_(new Date(now.getTime() + 7 * HOUR), now), 'valid');
});

test('토큰 원문은 시트에 저장되지 않는다', () => {
  fresh();
  const token = session.issueSession('U1');
  const rows = sheet.readAll('Sessions');
  assert.strictEqual(rows.length, 1);
  assert.notStrictEqual(rows[0].token_hash, token);
  assert.strictEqual(rows[0].user_id, 'U1');
});

test('발급한 토큰으로 사용자를 얻는다', () => {
  fresh();
  const token = session.issueSession('U1');
  const user = session.verifySession(token);
  assert.strictEqual(user.user_id, 'U1');
  assert.strictEqual(user.name, '홍길동');
});

test('토큰이 없거나 모르는 값이면 TOKEN_INVALID', () => {
  fresh();
  ['', null, undefined, '알수없는토큰'].forEach((bad) => {
    assert.throws(() => session.verifySession(bad), (err) => {
      assert.strictEqual(err.appCode, 'TOKEN_INVALID');
      return true;
    });
  });
});

test('만료된 토큰은 TOKEN_EXPIRED이고 세션이 삭제된다', () => {
  fresh();
  const issuedAt = new Date('2026-08-05T00:00:00Z');
  const token = session.issueSession('U1', issuedAt);
  const later = new Date(issuedAt.getTime() + 25 * HOUR);

  assert.throws(() => session.verifySession(token, later), (err) => {
    assert.strictEqual(err.appCode, 'TOKEN_EXPIRED');
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
});

test('만료가 임박하면 연장하고, 방금 연장한 토큰은 다시 연장하지 않는다', () => {
  fresh();
  const issuedAt = new Date('2026-08-05T00:00:00Z');
  const token = session.issueSession('U1', issuedAt);
  const original = new Date(sheet.readAll('Sessions')[0].expires_at).getTime();

  // 만료 5시간 전 → 연장된다
  const nearExpiry = new Date(issuedAt.getTime() + 19 * HOUR);
  session.verifySession(token, nearExpiry);
  const renewed = new Date(sheet.readAll('Sessions')[0].expires_at).getTime();
  assert.ok(renewed > original, '연장되어야 한다');

  // 연장 직후에는 남은 시간이 24시간이라 다시 연장되지 않는다
  const rightAfter = new Date(nearExpiry.getTime() + 1 * HOUR);
  session.verifySession(token, rightAfter);
  assert.strictEqual(new Date(sheet.readAll('Sessions')[0].expires_at).getTime(), renewed);
});

test('비활성 계정은 토큰이 있어도 거부된다', () => {
  fresh();
  const token = session.issueSession('U1');
  sheet.update('Users', 'U1', { status: 'inactive' });

  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'ACCOUNT_INACTIVE');
    return true;
  });
});

test('사용자가 사라진 세션은 TOKEN_INVALID이고 정리된다', () => {
  fresh();
  const token = session.issueSession('U1');
  sheet.deleteByPk('Users', 'U1');

  assert.throws(() => session.verifySession(token), (err) => {
    assert.strictEqual(err.appCode, 'TOKEN_INVALID');
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
});

test('revokeSession은 세션을 지운다', () => {
  fresh();
  const token = session.issueSession('U1');
  assert.strictEqual(session.revokeSession(token), true);
  assert.deepStrictEqual(sheet.readAll('Sessions'), []);
  assert.strictEqual(session.revokeSession(token), false);
  assert.strictEqual(session.revokeSession(''), false);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/lib/session'`

- [ ] **Step 3: 구현**

`apps-script/lib/session.js`:

```js
/**
 * 세션 토큰 발급과 검증.
 * 원문은 브라우저에만 주고 시트에는 해시만 저장한다. 스프레드시트가 유출되어도
 * 그 값으로 바로 로그인할 수 없게 하기 위해서다.
 */

var SESSION_HOURS = 24;
var SESSION_RENEW_WITHIN_HOURS = 6;

/**
 * 만료 상태를 판정한다. 시각을 인자로 받는 순수 함수라 경계값을 직접 검증할 수 있다.
 * 'expired' 만료됨 / 'renew' 유효하지만 연장 필요 / 'valid' 유효
 */
function sessionStatus_(expiresAt, now) {
  var expiry = new Date(expiresAt).getTime();
  var current = now.getTime();
  if (!expiry || current >= expiry) return 'expired';
  if (expiry - current <= SESSION_RENEW_WITHIN_HOURS * 3600 * 1000) return 'renew';
  return 'valid';
}

function issueSession(userId, now) {
  var issuedAt = now || new Date();
  var token = generateToken();
  insert('Sessions', {
    token_hash: sha256Hex(token),
    user_id: userId,
    created_at: issuedAt,
    expires_at: new Date(issuedAt.getTime() + SESSION_HOURS * 3600 * 1000),
  });
  return token;
}

/**
 * 토큰을 검증하고 사용자 레코드를 돌려준다.
 * 연장은 만료 6시간 이내일 때만 일어난다. 한 번 연장하면 남은 시간이 다시
 * 24시간이 되므로 이후 18시간 동안 연장 조건에 걸리지 않는다. 별도 장치 없이
 * 시트 쓰기가 자연히 제한된다.
 */
function verifySession(token, now) {
  var current = now || new Date();
  if (!token) throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');

  var hash = sha256Hex(token);
  var record = findByPk('Sessions', hash);
  if (!record) throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');

  if (sessionStatus_(record.expires_at, current) === 'expired') {
    deleteByPk('Sessions', hash);
    throw appError_('TOKEN_EXPIRED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  }

  var user = findByPk('Users', record.user_id);
  if (!user) {
    deleteByPk('Sessions', hash);
    throw appError_('TOKEN_INVALID', '로그인이 필요합니다.');
  }
  if (String(user.status) !== 'active') {
    // 세션을 남겨두면 계정을 다시 활성화했을 때 예전 세션이 재로그인 없이 되살아난다.
    // 계정 탈취가 의심되어 잠근 경우라면 공격자의 세션까지 부활하므로 지운다.
    deleteByPk('Sessions', hash);
    throw appError_('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  }

  if (sessionStatus_(record.expires_at, current) === 'renew') {
    update('Sessions', hash, {
      expires_at: new Date(current.getTime() + SESSION_HOURS * 3600 * 1000),
    });
  }

  return user;
}

function revokeSession(token) {
  if (!token) return false;
  return deleteByPk('Sessions', sha256Hex(token));
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./sheet');
  var hashLib = require('./hash');
  global.insert = sheetLib.insert;
  global.findByPk = sheetLib.findByPk;
  global.update = sheetLib.update;
  global.deleteByPk = sheetLib.deleteByPk;
  global.generateToken = hashLib.generateToken;
  global.sha256Hex = hashLib.sha256Hex;
  global.appError_ = require('./errors').appError_;

  module.exports = {
    SESSION_HOURS: SESSION_HOURS,
    SESSION_RENEW_WITHIN_HOURS: SESSION_RENEW_WITHIN_HOURS,
    sessionStatus_: sessionStatus_,
    issueSession: issueSession,
    verifySession: verifySession,
    revokeSession: revokeSession,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 83 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/lib/session.js test/session.test.js
git commit -m "feat: 세션 발급·검증·연장·폐기"
```

---

### Task 5: 회원가입과 응답 직렬화

`publicUser_`와 `handleSignup`을 만든다. 응답에 `password_hash`가 새어나가지 않는 것이 이 태스크의 핵심 성질이다.

**Files:**
- Create: `apps-script/handlers/auth.js`
- Modify: `apps-script/setup.js` (module.exports에 `RETENTION_YEARS` 추가)
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: `appError_` (errors.js), `normalizeEmail`/`isValidEmail`/`validatePassword`/`requireFields` (validate.js), `findByColumn`/`insert`/`newId` (sheet.js), `hashPassword` (hash.js), `issueSession` (session.js), `RETENTION_YEARS` (setup.js)
- Produces:
  - `publicUser_(user) -> object` — 화이트리스트로 걸러낸 응답용 객체
  - `handleSignup(payload) -> { token: string, user: object }`
  - 상수 `PUBLIC_USER_FIELDS` (배열)

- [ ] **Step 1: 실패하는 테스트 작성**

`test/auth.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/handlers/auth'`

- [ ] **Step 3: `setup.js`의 export에 `RETENTION_YEARS` 추가**

`apps-script/setup.js`의 `module.exports` 블록에 한 줄을 넣는다. 보관 기간 상수를 핸들러가 다시 적으면 두 곳이 어긋날 수 있다.

```js
    RETENTION_YEARS: RETENTION_YEARS,
```

- [ ] **Step 4: `apps-script/handlers/auth.js` 구현**

```js
/**
 * 인증 핸들러. 라우팅은 main.js가 담당하고 여기서는 각 기능의 내용만 다룬다.
 */

/**
 * 응답에 내보낼 필드 목록. 화이트리스트로 관리한다.
 * 시트에 열이 추가되어도 자동으로 새어나가지 않게 하기 위해서다.
 * password_hash는 물론이고 birth_date(수료증 발급 전용)와 동의 기록도 내보내지 않는다.
 */
var PUBLIC_USER_FIELDS = [
  'user_id', 'name', 'email', 'phone', 'company', 'position',
  'role', 'status', 'created_at',
];

function publicUser_(user) {
  var out = {};
  for (var i = 0; i < PUBLIC_USER_FIELDS.length; i++) {
    var field = PUBLIC_USER_FIELDS[i];
    if (user[field] !== undefined) out[field] = user[field];
  }
  return out;
}

var SIGNUP_REQUIRED_FIELDS = [
  'name', 'email', 'password', 'phone', 'company', 'position', 'birth_date',
];

function handleSignup(payload) {
  var missing = requireFields(payload, SIGNUP_REQUIRED_FIELDS);
  if (missing.length) {
    throw appError_('BAD_REQUEST', '필수 항목이 비어 있습니다: ' + missing.join(', '));
  }
  if (payload.consent !== true) {
    throw appError_('BAD_REQUEST', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
  }

  var email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    throw appError_('BAD_REQUEST', '이메일 형식이 올바르지 않습니다.');
  }

  var passwordError = validatePassword(payload.password);
  if (passwordError) {
    throw appError_('BAD_REQUEST', passwordError);
  }

  if (findByColumn('Users', 'email', email)) {
    throw appError_('EMAIL_TAKEN', '이미 가입된 이메일입니다.');
  }

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var user = {
    user_id: newId('U'),
    name: String(payload.name).trim(),
    email: email,
    password_hash: hashPassword(payload.password),
    phone: String(payload.phone).trim(),
    company: String(payload.company).trim(),
    position: String(payload.position).trim(),
    birth_date: String(payload.birth_date).trim(),
    role: 'student',
    status: 'active',
    consent_at: now,
    retention_until: retention,
    created_at: now,
  };

  insert('Users', user);

  // 별도 승인 절차가 없으므로 가입 직후 바로 로그인 상태로 넘긴다.
  var token = issueSession(user.user_id, now);
  return { token: token, user: publicUser_(user) };
}

if (typeof module !== 'undefined') {
  var sheetLib = require('../lib/sheet');
  var validateLib = require('../lib/validate');
  global.appError_ = require('../lib/errors').appError_;
  global.normalizeEmail = validateLib.normalizeEmail;
  global.isValidEmail = validateLib.isValidEmail;
  global.validatePassword = validateLib.validatePassword;
  global.requireFields = validateLib.requireFields;
  global.findByColumn = sheetLib.findByColumn;
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.hashPassword = require('../lib/hash').hashPassword;
  global.issueSession = require('../lib/session').issueSession;
  global.RETENTION_YEARS = require('../setup').RETENTION_YEARS;

  module.exports = {
    PUBLIC_USER_FIELDS: PUBLIC_USER_FIELDS,
    publicUser_: publicUser_,
    handleSignup: handleSignup,
  };
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 94 tests pass

- [ ] **Step 6: 커밋**

```bash
git add apps-script/handlers/auth.js apps-script/setup.js test/auth.test.js
git commit -m "feat: 회원가입과 응답 직렬화 화이트리스트"
```

---

### Task 6: 로그인

시도 제한, 이메일 조회, 비밀번호 검증을 엮는다. 계정 열거를 막는 동일 응답이 이 태스크의 핵심 성질이다.

**Files:**
- Modify: `apps-script/handlers/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: Task 5의 `publicUser_`, `isLocked`/`recordFailure`/`clearFailures` (ratelimit.js), `verifyPassword` (hash.js), `findByColumn` (sheet.js), `issueSession` (session.js)
- Produces: `handleLogin(payload) -> { token: string, user: object }`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/auth.test.js` 끝에 추가한다. 파일 상단의 `fresh()`와 `signupPayload()`를 그대로 쓴다.

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `auth.handleLogin is not a function`

- [ ] **Step 3: 구현**

`apps-script/handlers/auth.js`의 `handleSignup` 아래에 추가한다.

```js
function handleLogin(payload) {
  var email = normalizeEmail(payload.email);
  var password = payload.password;
  if (!email || !password) {
    throw appError_('BAD_REQUEST', '이메일과 비밀번호를 입력해 주세요.');
  }

  // 잠긴 계정은 비밀번호를 검증하지 않고 즉시 거부하며 카운터도 늘리지 않는다.
  // 늘리면 공격자가 요청을 계속 보내는 것만으로 잠금을 무한히 연장할 수 있다.
  if (isLocked(email)) {
    throw appError_('ACCOUNT_LOCKED', '로그인 시도가 많아 잠시 잠겼습니다. 10분 후 다시 시도해 주세요.');
  }

  var user = findByColumn('Users', 'email', email);
  var matched = false;
  if (user) {
    try {
      matched = verifyPassword(password, user.password_hash);
    } catch (err) {
      // 저장값이 손상되어도 로그인 기능 전체가 죽어서는 안 된다.
      // 그 계정만 실패시키고 원인 파악을 위해 기록은 남긴다.
      logError_('auth.login', user.user_id, err);
      matched = false;
    }
  }

  // 이메일이 없는 경우와 비밀번호가 틀린 경우를 구분해 알려주면
  // 어떤 이메일이 가입돼 있는지 확인하는 수단이 된다. 같은 응답을 준다.
  if (!user || !matched) {
    recordFailure(email);
    throw appError_('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  if (String(user.status) !== 'active') {
    throw appError_('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  }

  clearFailures(email);
  return { token: issueSession(user.user_id), user: publicUser_(user) };
}
```

`module.exports` 블록에 다음 주입과 export를 추가한다. `logError_`는 main.js가 정의하지만 Task 8에서 만들어지므로, 그때까지 이 파일의 테스트에서는 아무 일도 하지 않는 대체 함수를 쓴다.

```js
  var ratelimitLib = require('../lib/ratelimit');
  global.isLocked = ratelimitLib.isLocked;
  global.recordFailure = ratelimitLib.recordFailure;
  global.clearFailures = ratelimitLib.clearFailures;
  global.verifyPassword = require('../lib/hash').verifyPassword;
  if (typeof global.logError_ !== 'function') {
    global.logError_ = function () {};
  }
```

그리고 `module.exports`에 `handleLogin: handleLogin,`을 추가한다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 102 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/handlers/auth.js test/auth.test.js
git commit -m "feat: 로그인과 시도 제한"
```

---

### Task 7: 로그아웃·내 정보·프로필 수정

토큰 검증을 통과한 사용자를 인자로 받는 나머지 세 핸들러를 만든다.

**Files:**
- Modify: `apps-script/handlers/auth.js`
- Test: `test/auth.test.js`

**Interfaces:**
- Consumes: Task 5의 `publicUser_`, `revokeSession` (session.js), `update`/`findByPk` (sheet.js)
- Produces:
  - `handleLogout(payload, user) -> { ok: true }` — `payload.token`이 아니라 요청의 토큰을 쓴다. main.js가 `payload._token`으로 전달한다.
  - `handleMe(payload, user) -> object` — `publicUser_(user)`
  - `handleUpdateProfile(payload, user) -> object` — 수정 후의 `publicUser_`
  - 상수 `EDITABLE_PROFILE_FIELDS`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/auth.test.js` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `auth.handleMe is not a function`

- [ ] **Step 3: 구현**

`apps-script/handlers/auth.js`의 `handleLogin` 아래에 추가한다.

```js
/**
 * 본인이 고칠 수 있는 필드. 화이트리스트로 관리한다.
 * email은 로그인 ID라 중복 검사와 세션 처리가 함께 필요하고, role과 status는
 * 관리자 권한이며, password_hash는 비밀번호 변경 기능이 따로 있어야 한다.
 */
var EDITABLE_PROFILE_FIELDS = ['name', 'phone', 'company', 'position', 'birth_date'];

function handleMe(payload, user) {
  return publicUser_(user);
}

function handleUpdateProfile(payload, user) {
  var patch = {};
  for (var i = 0; i < EDITABLE_PROFILE_FIELDS.length; i++) {
    var field = EDITABLE_PROFILE_FIELDS[i];
    var value = payload[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      patch[field] = String(value).trim();
    }
  }

  // 대상은 언제나 토큰에서 확인한 사용자다. payload.user_id는 쓰지 않는다.
  // 받아서 쓰면 남의 계정을 고치는 통로가 된다.
  var updated = update('Users', user.user_id, patch);
  return publicUser_(updated);
}

function handleLogout(payload, user) {
  revokeSession(payload._token);
  return { ok: true };
}
```

`module.exports` 블록에 다음을 추가한다.

```js
  global.update = sheetLib.update;
  global.revokeSession = require('../lib/session').revokeSession;
```

그리고 `module.exports`에 `EDITABLE_PROFILE_FIELDS`, `handleMe`, `handleUpdateProfile`, `handleLogout`을 추가한다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 107 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/handlers/auth.js test/auth.test.js
git commit -m "feat: 로그아웃·내 정보·프로필 수정 핸들러"
```

---

### Task 8: 라우팅과 통합 테스트

`doPost` 진입점, 라우팅 표, 권한 검사, 오류 응답, ErrorLog 기록을 만든다. 가입부터 로그인까지 전 과정을 `doPost`로 통과시키는 통합 테스트로 마무리한다.

**Files:**
- Create: `apps-script/main.js`
- Modify: `test/helpers/gas-shim.js` (`ContentService` 대역 추가)
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `verifySession` (session.js), 모든 핸들러 (handlers/auth.js), `insert`/`newId` (sheet.js), `appError_`/`isAppError_` (errors.js)
- Produces: `doPost(e)`, `doGet()`, `logError_(action, userId, err)`, `routes_() -> object` (action을 키로 `{ handler, roles }`를 담은 표), 상수 `PUBLIC`, `ANY_USER`

**라우팅 표를 함수 안에서 만드는 이유.** `var ROUTES = { handler: handleSignup, ... }` 형태로 파일 최상단에 두면 Node에서 `require` 하는 순간 죽는다. Apps Script는 모든 파일을 한 전역 스코프에 이어 붙이므로 `handleSignup`이 보이지만, Node에서는 이 파일이 평가되는 시점에 그 이름이 선언되어 있지 않고, 선언되지 않은 식별자를 읽는 것은 `undefined`가 아니라 `ReferenceError`다. 표를 함수 안에서 만들면 이름이 호출 시점에 해석되므로 두 런타임 모두에서 동작한다.

- [ ] **Step 1: 셰임에 `ContentService` 추가**

`test/helpers/gas-shim.js`의 `Utilities` 정의 아래에 추가한다.

```js
const ContentService = {
  MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
  createTextOutput(content) {
    let mimeType = 'text/plain';
    const output = {
      getContent: () => content,
      getMimeType: () => mimeType,
      setMimeType(type) {
        mimeType = type;
        return output;
      },
    };
    return output;
  },
};
```

`installGlobals()`에 `global.ContentService = ContentService;`를 추가하고, `module.exports`에 `ContentService`를 추가한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`test/api.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const sheet = require('../apps-script/lib/sheet');
const setup = require('../apps-script/setup');
const main = require('../apps-script/main');

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
}

function post(action, payload, token) {
  const body = JSON.stringify({ action, token, payload });
  const output = main.doPost({ postData: { contents: body } });
  return JSON.parse(output.getContent());
}

const SIGNUP = {
  name: '홍길동', email: 'Hong@IGM.co.kr', password: 'abcd1234',
  phone: '010-1234-5678', company: '아이지엠', position: '팀장',
  birth_date: '1985-03-02', consent: true,
};

test('가입 → 로그인 → 내 정보 조회가 한 흐름으로 동작한다', () => {
  fresh();

  const signup = post('auth.signup', SIGNUP);
  assert.strictEqual(signup.ok, true);
  assert.ok(signup.data.token);

  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  assert.strictEqual(login.ok, true);

  const me = post('auth.me', {}, login.data.token);
  assert.strictEqual(me.ok, true);
  assert.strictEqual(me.data.email, 'hong@igm.co.kr');
  assert.strictEqual(me.data.name, '홍길동');
});

test('어떤 응답에도 비밀번호 해시가 실리지 않는다', () => {
  fresh();
  const signup = post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  const me = post('auth.me', {}, login.data.token);

  [signup, login, me].forEach((response) => {
    assert.strictEqual(JSON.stringify(response).indexOf('pbkdf2'), -1);
    assert.strictEqual(JSON.stringify(response).indexOf('password_hash'), -1);
  });
});

test('토큰 없이 보호된 기능을 부르면 거부된다', () => {
  fresh();
  const response = post('auth.me', {});
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'TOKEN_INVALID');
});

test('라우팅 표의 PUBLIC이 아닌 모든 action이 토큰을 요구한다', () => {
  fresh();
  const routes = main.routes_();
  const guarded = Object.keys(routes).filter((action) => routes[action].roles !== main.PUBLIC);
  assert.ok(guarded.length >= 3, '보호되는 action이 있어야 이 검사가 의미를 가진다');

  guarded.forEach((action) => {
    const response = post(action, {});
    assert.strictEqual(response.ok, false, `${action}이 토큰 없이 통과했다`);
    assert.strictEqual(response.error.code, 'TOKEN_INVALID', `${action}의 오류 코드가 다르다`);
  });
});

test('모든 라우팅 항목이 실제 함수를 가리킨다', () => {
  const routes = main.routes_();
  Object.keys(routes).forEach((action) => {
    assert.strictEqual(typeof routes[action].handler, 'function', `${action}의 핸들러가 함수가 아니다`);
    assert.ok(routes[action].roles, `${action}에 roles가 없다`);
  });
});

test('알 수 없는 action은 UNKNOWN_ACTION', () => {
  fresh();
  const response = post('없는.기능', {});
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'UNKNOWN_ACTION');
});

test('본문이 JSON이 아니면 BAD_REQUEST이고 ErrorLog에 남기지 않는다', () => {
  fresh();
  const output = main.doPost({ postData: { contents: '{망가진 본문' } });
  const response = JSON.parse(output.getContent());
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'BAD_REQUEST');
  assert.deepStrictEqual(sheet.readAll('ErrorLog'), []);
});

test('로그인 실패는 ErrorLog를 채우지 않는다', () => {
  fresh();
  post('auth.signup', SIGNUP);
  for (let i = 0; i < 3; i += 1) {
    post('auth.login', { email: 'hong@igm.co.kr', password: 'wrongpass1' });
  }
  assert.deepStrictEqual(sheet.readAll('ErrorLog'), []);
});

test('예기치 못한 예외는 ErrorLog에 남고 내부 사정을 노출하지 않는다', () => {
  fresh();
  main.routes_()['test.boom'] = {
    handler: function () { throw new Error('내부 스택 추적 정보'); },
    roles: main.PUBLIC,
  };

  try {
    const response = post('test.boom', {});
    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'INTERNAL');
    assert.strictEqual(response.error.message.indexOf('내부 스택 추적'), -1);

    const logs = sheet.readAll('ErrorLog');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, 'test.boom');
    assert.match(logs[0].message, /내부 스택 추적/);
  } finally {
    delete main.routes_()['test.boom'];
  }
});

test('로그아웃하면 그 토큰이 더는 통하지 않는다', () => {
  fresh();
  post('auth.signup', SIGNUP);
  const login = post('auth.login', { email: 'hong@igm.co.kr', password: 'abcd1234' });
  const token = login.data.token;

  assert.strictEqual(post('auth.me', {}, token).ok, true);
  assert.strictEqual(post('auth.logout', {}, token).ok, true);

  const after = post('auth.me', {}, token);
  assert.strictEqual(after.ok, false);
  assert.strictEqual(after.error.code, 'TOKEN_INVALID');
});

test('doGet은 상태만 알려주고 데이터를 다루지 않는다', () => {
  fresh();
  const response = JSON.parse(main.doGet().getContent());
  assert.strictEqual(response.ok, true);
  assert.strictEqual(JSON.stringify(response).indexOf('password'), -1);
});
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/main'`

- [ ] **Step 4: 구현**

`apps-script/main.js`:

```js
/**
 * 웹앱 진입점. 요청은 단일 엔드포인트로 POST되고 본문의 action으로 갈라진다.
 *
 * 중요: Apps Script 웹앱은 CORS 사전 요청(preflight)에 응답할 수 없다.
 * 프론트는 Content-Type을 text/plain으로 보내 사전 요청 자체가 생기지 않게 해야 하며,
 * 그래서 세션 토큰도 헤더가 아니라 본문에 담는다.
 */

var PUBLIC = 'PUBLIC';
var ANY_USER = 'ANY_USER';

var routesCache_ = null;

/**
 * 라우팅 표. 함수 안에서 만드는 이유는 이름 해석 시점 때문이다.
 * 파일 최상단에서 리터럴로 만들면 Node에서 require 하는 순간 handleSignup 등이
 * 아직 선언되지 않아 ReferenceError가 난다. 함수 안에 두면 첫 호출 시점에
 * 해석되므로 Apps Script와 Node 양쪽에서 동작한다.
 */
function routes_() {
  if (!routesCache_) {
    routesCache_ = {
      'auth.signup':        { handler: handleSignup,        roles: PUBLIC },
      'auth.login':         { handler: handleLogin,         roles: PUBLIC },
      'auth.logout':        { handler: handleLogout,        roles: ANY_USER },
      'auth.me':            { handler: handleMe,            roles: ANY_USER },
      'auth.updateProfile': { handler: handleUpdateProfile, roles: ANY_USER },
    };
  }
  return routesCache_;
}

function doGet() {
  return jsonOutput_({ ok: true, data: { service: 'IGM LMS API', status: 'ok' } });
}

function doPost(e) {
  var action = '';
  var userId = '';

  try {
    var request = parseRequest_(e);
    action = request.action;

    var route = routes_()[action];
    if (!route) {
      throw appError_('UNKNOWN_ACTION', '알 수 없는 요청입니다.');
    }

    var user = null;
    if (route.roles !== PUBLIC) {
      user = verifySession(request.token);
      userId = user.user_id;
      if (route.roles !== ANY_USER && route.roles.indexOf(String(user.role)) === -1) {
        throw appError_('FORBIDDEN', '권한이 없습니다.');
      }
    }

    // 로그아웃은 요청에 실린 토큰 자체가 필요하다. 핸들러가 토큰을 다시 파싱하지
    // 않도록 payload에 실어 전달한다.
    var payload = request.payload;
    payload._token = request.token;

    return jsonOutput_({ ok: true, data: route.handler(payload, user) });
  } catch (err) {
    if (isAppError_(err)) {
      return jsonOutput_({ ok: false, error: { code: err.appCode, message: err.message } });
    }
    logError_(action, userId, err);
    return jsonOutput_({
      ok: false,
      error: { code: 'INTERNAL', message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
    });
  }
}

function parseRequest_(e) {
  var body = e && e.postData ? e.postData.contents : '';
  var parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch (err) {
    // 본문이 깨진 것은 클라이언트 문제다. ErrorLog를 채울 이유가 없다.
    throw appError_('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
  return {
    action: String(parsed.action || ''),
    token: parsed.token || '',
    payload: parsed.payload || {},
  };
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 예기치 못한 예외만 남긴다. 로깅이 실패해도 원래 오류를 덮지 않는다. */
function logError_(action, userId, err) {
  try {
    insert('ErrorLog', {
      log_id: newId('E'),
      occurred_at: new Date(),
      action: action || '',
      user_id: userId || '',
      message: err && err.message ? String(err.message) : String(err),
      stack: err && err.stack ? String(err.stack) : '',
    });
  } catch (ignored) {
    // 무시한다
  }
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./lib/sheet');
  var errorsLib = require('./lib/errors');
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.appError_ = errorsLib.appError_;
  global.isAppError_ = errorsLib.isAppError_;
  global.logError_ = logError_;
  global.verifySession = require('./lib/session').verifySession;

  var authHandlers = require('./handlers/auth');
  global.handleSignup = authHandlers.handleSignup;
  global.handleLogin = authHandlers.handleLogin;
  global.handleLogout = authHandlers.handleLogout;
  global.handleMe = authHandlers.handleMe;
  global.handleUpdateProfile = authHandlers.handleUpdateProfile;

  module.exports = {
    PUBLIC: PUBLIC,
    ANY_USER: ANY_USER,
    routes_: routes_,
    doGet: doGet,
    doPost: doPost,
    logError_: logError_,
  };
}
```

`global.logError_`를 `require('./handlers/auth')`보다 먼저 설정하는 순서가 중요하다. `handlers/auth.js`는 `logError_`가 아직 없으면 아무 일도 하지 않는 대체 함수를 넣는데, 순서가 뒤바뀌면 그 대체 함수가 실제 로거를 밀어내 손상된 저장값을 만났을 때 기록이 남지 않는다.

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 118 tests pass

- [ ] **Step 6: Apps Script에 업로드해 배포 확인**

```bash
cd apps-script && clasp push
```

편집기에서 `doGet`을 실행해 예외 없이 끝나는지 확인한다. 실제 웹앱 배포와 브라우저 연동은 다음 계획에서 다룬다.

- [ ] **Step 7: 커밋**

```bash
git add apps-script/main.js test/helpers/gas-shim.js test/api.test.js
git commit -m "feat: 요청 라우팅과 권한 검사, 오류 응답"
```

---

## 완료 기준

- `npm test`가 118개 테스트를 통과하고 출력이 깨끗하다.
- `doPost`를 통해 가입 → 로그인 → 내 정보 조회가 동작한다.
- 어떤 응답에도 `password_hash`가 포함되지 않는다.
- 없는 이메일과 틀린 비밀번호가 같은 코드·같은 메시지를 반환한다.
- 대소문자만 다른 이메일로 중복 가입할 수 없고, 대문자로 입력해도 로그인된다.
- 로그인 실패는 ErrorLog를 채우지 않고, 예기치 못한 예외만 기록된다.
- 라우팅 표의 `PUBLIC`이 아닌 모든 action이 토큰 없이는 거부된다.

## 다음 계획

**인증 프론트엔드와 배포** — `config.js`·`api.js`·`auth.js` 통신 모듈, 로그인·회원가입 화면, 웹앱 배포와 GitHub Pages 활성화, 브라우저에서의 종단 확인.

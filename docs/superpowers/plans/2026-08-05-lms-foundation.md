# LMS 기반 구조 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apps Script 프로젝트에서 `setupSheets()`를 실행하면 13개 시트가 생성되고, `seedAdmin()`으로 검증 가능한 비밀번호 해시를 가진 관리자 계정이 만들어지는 상태까지 구축한다.

**Architecture:** Apps Script를 백엔드로 쓰고 Google Sheets를 저장소로 쓴다. 스키마 정의를 단일 출처로 두고 시트 접근 계층이 이를 참조한다. Sheets나 Apps Script 런타임에 의존하지 않는 순수 로직은 별도 파일로 분리해 Node에서 단위 테스트한다.

**Tech Stack:** Google Apps Script (V8), clasp, Node.js 내장 테스트 러너(`node:test`), 의존성 없음

## Global Constraints

- Apps Script 코드는 `var` 함수 선언 스타일을 쓴다. clasp가 올리는 `.js` 파일은 전역 스코프에서 이어 붙여지므로 `import`/`export` 구문을 쓸 수 없다.
- Node 테스트를 위해 각 Apps Script 파일 끝에 `if (typeof module !== 'undefined') { module.exports = {...}; }`를 둔다. Apps Script 런타임에는 `module`이 없으므로 이 블록은 무시된다.
- 스프레드시트 ID는 스크립트 속성 `SPREADSHEET_ID`에서 읽는다. 코드에 하드코딩하지 않는다.
- 시트 이름과 헤더는 `apps-script/schema.js`의 `SHEETS`가 유일한 출처다. 다른 파일에서 헤더 문자열을 직접 쓰지 않는다.
- 기존 데이터를 지우는 동작은 `resetAllSheets(confirmation)` 한 곳에만 존재한다. `setupSheets()`는 어떤 경우에도 기존 시트를 지우거나 비우지 않는다.
- 비밀번호 해시 저장 형식은 `pbkdf2$<반복횟수>$<salt hex>$<해시 hex>`다.
- 외부 npm 의존성을 추가하지 않는다. 테스트는 Node 18 이상의 내장 기능만 쓴다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json` | 테스트 스크립트 정의 |
| `.nojekyll` | GitHub Pages의 Jekyll 처리 비활성화 |
| `test/helpers/gas-shim.js` | Node에서 `Utilities`, `CacheService`, `PropertiesService`를 흉내내는 셰임 |
| `test/helpers/sheets-fake.js` | 메모리 기반 `SpreadsheetApp` 대역 |
| `apps-script/schema.js` | 13개 시트의 이름과 헤더 정의 |
| `apps-script/lib/hash.js` | PBKDF2 해싱, 비밀번호 검증, 토큰 생성 |
| `apps-script/lib/sheet.js` | 시트 접근 계층과 행 인덱스 캐시 |
| `apps-script/setup.js` | `setupSheets` / `seedAdmin` / `resetAllSheets` |
| `apps-script/appsscript.json` | Apps Script 매니페스트 |
| `test/hash.test.js` | 해싱 단위 테스트 |
| `test/schema.test.js` | 스키마 정합성 테스트 |
| `test/sheet.test.js` | 시트 접근 계층 테스트 |
| `test/setup.test.js` | 초기 구성 함수 테스트 |

---

### Task 1: 프로젝트 스캐폴딩과 Apps Script 셰임

Node에서 Apps Script 코드를 테스트할 수 있는 토대를 만든다. 이 태스크가 끝나면 `npm test`가 동작한다.

**Files:**
- Create: `package.json`
- Create: `.nojekyll`
- Create: `test/helpers/gas-shim.js`
- Create: `test/smoke.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `gas-shim.js`가 `{ Utilities, CacheService, PropertiesService, toSigned, toBuffer, installGlobals, resetShim }`를 export한다. `installGlobals()`는 셰임을 Node 전역에 설치하고, `resetShim()`은 캐시·속성 저장소를 비운다.

- [ ] **Step 1: `package.json` 생성**

```json
{
  "name": "igm-lms",
  "version": "0.1.0",
  "private": true,
  "description": "IGM 공개과정 e러닝 LMS",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 2: `.nojekyll` 생성**

빈 파일로 만든다. GitHub Pages는 기본적으로 Jekyll로 사이트를 처리하는데, 이때 밑줄로 시작하는 폴더가 무시된다. 정적 파일을 그대로 내보내려면 이 파일이 필요하다.

```bash
touch .nojekyll
```

- [ ] **Step 3: `.gitignore`에 clasp 인증 파일 추가**

`.gitignore` 끝에 다음을 추가한다. `.clasp.json`은 스크립트 ID만 담고 있어 커밋하지만, `.clasprc.json`에는 인증 토큰이 들어가므로 반드시 제외한다.

```
# clasp
.clasprc.json
```

- [ ] **Step 4: Apps Script 셰임 작성**

`test/helpers/gas-shim.js`를 만든다. Apps Script의 바이트 배열은 부호 있는 값(-128~127)이므로 Node의 Buffer와 변환이 필요하다.

```js
'use strict';

const crypto = require('node:crypto');

function toSigned(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    out[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
  }
  return out;
}

function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(value.map((b) => (b < 0 ? b + 256 : b)));
}

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeHmacSha256Signature(value, key) {
    return toSigned(
      crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()
    );
  },
  computeDigest(_algorithm, value) {
    return toSigned(crypto.createHash('sha256').update(toBuffer(value)).digest());
  },
  getUuid() {
    return crypto.randomUUID();
  },
  newBlob(value) {
    const buf = Buffer.from(String(value), 'utf8');
    return { getBytes: () => toSigned(buf) };
  },
};

const cacheStore = new Map();
const CacheService = {
  getScriptCache() {
    return {
      get: (key) => (cacheStore.has(key) ? cacheStore.get(key) : null),
      put: (key, value) => { cacheStore.set(key, String(value)); },
      remove: (key) => { cacheStore.delete(key); },
    };
  },
};

const propertyStore = new Map();
const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty: (key) => (propertyStore.has(key) ? propertyStore.get(key) : null),
      setProperty: (key, value) => { propertyStore.set(key, String(value)); },
      deleteProperty: (key) => { propertyStore.delete(key); },
    };
  },
};

function installGlobals() {
  global.Utilities = Utilities;
  global.CacheService = CacheService;
  global.PropertiesService = PropertiesService;
}

function resetShim() {
  cacheStore.clear();
  propertyStore.clear();
}

module.exports = {
  Utilities,
  CacheService,
  PropertiesService,
  toSigned,
  toBuffer,
  installGlobals,
  resetShim,
};
```

- [ ] **Step 5: 셰임 검증 테스트 작성**

`test/smoke.test.js`를 만든다. 셰임의 HMAC이 Node의 표준 구현과 일치하는지 확인한다. 이게 맞아야 이후 해싱 테스트를 믿을 수 있다.

```js
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
```

- [ ] **Step 6: 테스트 실행**

Run: `npm test`
Expected: 2 tests pass

- [ ] **Step 7: 커밋**

```bash
git add package.json .nojekyll .gitignore test/
git commit -m "chore: Node 테스트 환경과 Apps Script 셰임 추가"
```

---

### Task 2: 시트 스키마 정의

13개 시트의 이름과 헤더를 한 곳에 정의한다. 이후 모든 코드가 이 정의를 참조한다.

**Files:**
- Create: `apps-script/schema.js`
- Test: `test/schema.test.js`

**Interfaces:**
- Produces: 전역 `SHEETS` — 시트 이름을 키로, 헤더 문자열 배열을 값으로 갖는 객체. 각 배열의 첫 항목이 그 시트의 기본키 열이다. `module.exports = { SHEETS }`.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schema.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/schema'`

- [ ] **Step 3: 스키마 구현**

`apps-script/schema.js`:

```js
/**
 * 시트 이름과 헤더 정의. 이 파일이 스키마의 유일한 출처다.
 * 각 배열의 첫 항목이 그 시트의 기본키 열이다.
 */
var SHEETS = {
  Users: [
    'user_id', 'name', 'email', 'password_hash', 'phone', 'company', 'position',
    'birth_date', 'role', 'status', 'consent_at', 'retention_until', 'created_at',
  ],
  Sessions: ['token_hash', 'user_id', 'created_at', 'expires_at'],
  Classes: [
    'class_id', 'class_name', 'batch', 'instructor_id', 'start_date', 'end_date',
    'watch_rate_threshold', 'quiz_pass_score', 'quiz_retry_allowed', 'status',
  ],
  Enrollments: ['enrollment_id', 'user_id', 'class_id', 'enrolled_at', 'status'],
  Lessons: [
    'lesson_id', 'class_id', 'lesson_order', 'title', 'video_url', 'video_duration_sec',
  ],
  WatchLogs: [
    'watch_log_id', 'user_id', 'lesson_id', 'max_watched_sec', 'watch_rate',
    'completed', 'last_updated_at',
  ],
  Quizzes: ['quiz_id', 'lesson_id', 'quiz_title', 'pass_score'],
  QuizQuestions: [
    'question_id', 'quiz_id', 'question_text', 'option1', 'option2', 'option3',
    'option4', 'correct_option', 'score',
  ],
  QuizAttempts: ['attempt_id', 'user_id', 'quiz_id', 'score', 'is_passed', 'submitted_at'],
  QuizAnswers: ['answer_id', 'attempt_id', 'question_id', 'selected_option', 'is_correct'],
  Attendance: [
    'attendance_id', 'user_id', 'class_id', 'total_watch_rate', 'total_quiz_score',
    'is_completed', 'completed_at',
  ],
  Certificates: ['certificate_id', 'attendance_id', 'certificate_no', 'issued_at', 'file_id'],
  ErrorLog: ['log_id', 'occurred_at', 'action', 'user_id', 'message', 'stack'],
};

if (typeof module !== 'undefined') {
  module.exports = { SHEETS: SHEETS };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 6 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/schema.js test/schema.test.js
git commit -m "feat: 13개 시트 스키마 정의"
```

---

### Task 3: 비밀번호 해싱과 토큰 생성

PBKDF2를 직접 구현한다. 구현이 표준과 일치하는지 Node의 `crypto.pbkdf2Sync` 결과와 대조해 검증한다.

**Files:**
- Create: `apps-script/lib/hash.js`
- Test: `test/hash.test.js`

**Interfaces:**
- Consumes: 전역 `Utilities` (Apps Script 런타임 또는 셰임)
- Produces:
  - `hashPassword(password, iterations?, saltBytes?) -> string` — `pbkdf2$<반복횟수>$<salt hex>$<해시 hex>`
  - `verifyPassword(password, stored) -> boolean`
  - `generateToken() -> string` — 64자 16진 문자열
  - `sha256Hex(value) -> string`
  - `bytesToHex_(bytes) -> string`, `hexToBytes_(hex) -> number[]`, `strToBytes_(s) -> number[]`
  - `pbkdf2Sha256_(passwordBytes, saltBytes, iterations) -> number[]`
  - 상수 `HASH_ITERATIONS`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/hash.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/lib/hash'`

- [ ] **Step 3: 해싱 구현**

`apps-script/lib/hash.js`:

```js
/**
 * 비밀번호 해싱과 토큰 생성.
 * Apps Script에는 bcrypt류 라이브러리가 없어 PBKDF2-HMAC-SHA256을 직접 구현한다.
 */

/**
 * 반복 횟수. 실제 환경에서 benchmarkHash()로 측정한 뒤 조정한다.
 * 로그인 응답이 1초를 넘지 않는 선에서 가장 큰 값을 쓴다.
 */
var HASH_ITERATIONS = 10000;

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function hexToBytes_(hex) {
  var out = [];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

function strToBytes_(value) {
  return Utilities.newBlob(String(value)).getBytes();
}

function randomBytes_(length) {
  var hex = '';
  while (hex.length < length * 2) {
    hex += Utilities.getUuid().replace(/-/g, '');
  }
  return hexToBytes_(hex.substring(0, length * 2));
}

/**
 * PBKDF2-HMAC-SHA256. 출력 길이는 32바이트 고정이므로 블록은 하나뿐이다.
 * T = U1 xor U2 xor ... xor Uc,  U1 = HMAC(pw, salt || 0x00000001)
 */
function pbkdf2Sha256_(passwordBytes, saltBytes, iterations) {
  var block = saltBytes.concat([0, 0, 0, 1]);
  var u = Utilities.computeHmacSha256Signature(block, passwordBytes);
  var result = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (var j = 0; j < result.length; j++) {
      result[j] = result[j] ^ u[j];
    }
  }
  return result;
}

function hashPassword(password, iterations, saltBytes) {
  var iter = iterations || HASH_ITERATIONS;
  var salt = saltBytes || randomBytes_(16);
  var derived = pbkdf2Sha256_(strToBytes_(password), salt, iter);
  return 'pbkdf2$' + iter + '$' + bytesToHex_(salt) + '$' + bytesToHex_(derived);
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function verifyPassword(password, stored) {
  var parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  var iter = parseInt(parts[1], 10);
  if (!iter || iter < 1) return false;
  if (parts[2].length !== 32 || parts[3].length !== 64) return false;
  var derived = pbkdf2Sha256_(strToBytes_(password), hexToBytes_(parts[2]), iter);
  return constantTimeEquals_(bytesToHex_(derived), parts[3]);
}

/** UUID 두 개를 이어 붙여 256비트 토큰을 만든다. getUuid는 보안 난수를 쓴다. */
function generateToken() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sha256Hex(value) {
  return bytesToHex_(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
  );
}

/** Apps Script 편집기에서 직접 실행해 반복 횟수를 정하는 데 쓴다. */
function benchmarkHash() {
  var started = new Date().getTime();
  hashPassword('benchmark-password-1234', HASH_ITERATIONS);
  var elapsed = new Date().getTime() - started;
  Logger.log(HASH_ITERATIONS + '회 해싱: ' + elapsed + 'ms');
  return elapsed;
}

if (typeof module !== 'undefined') {
  module.exports = {
    HASH_ITERATIONS: HASH_ITERATIONS,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    generateToken: generateToken,
    sha256Hex: sha256Hex,
    bytesToHex_: bytesToHex_,
    hexToBytes_: hexToBytes_,
    strToBytes_: strToBytes_,
    pbkdf2Sha256_: pbkdf2Sha256_,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 16 tests pass

첫 번째 테스트가 통과한다는 것은 직접 구현한 PBKDF2가 표준 알고리즘과 바이트 단위로 동일하다는 뜻이다. 이게 실패하면 비트 연산이나 바이트 부호 처리를 다시 봐야 한다.

- [ ] **Step 5: 커밋**

```bash
git add apps-script/lib/hash.js test/hash.test.js
git commit -m "feat: PBKDF2 비밀번호 해싱과 세션 토큰 생성"
```

---

### Task 4: 시트 접근 계층

Sheets를 읽고 쓰는 공통 계층을 만든다. 기본키로 행을 찾을 때 캐시를 쓰되, 관리자가 시트를 직접 편집해 행이 밀렸을 가능성을 매번 확인한다.

**Files:**
- Create: `test/helpers/sheets-fake.js`
- Create: `apps-script/lib/sheet.js`
- Test: `test/sheet.test.js`

**Interfaces:**
- Consumes: `SHEETS` (Task 2), 전역 `SpreadsheetApp`, `CacheService`, `PropertiesService`
- Produces:
  - `readAll(name) -> object[]`
  - `findByPk(name, pk) -> object | null`
  - `findBy(name, field, value) -> object | null`
  - `insert(name, obj) -> object`
  - `update(name, pk, patch) -> object | null`
  - `upsert(name, obj) -> object`
  - `deleteByPk(name, pk) -> boolean`
  - `newId(prefix) -> string`
  - `getSheet_(name)`, `getSpreadsheet_()`

- [ ] **Step 1: 메모리 기반 SpreadsheetApp 대역 작성**

`test/helpers/sheets-fake.js`:

```js
'use strict';

function createSheet(name) {
  const data = [];

  function ensureRow(index) {
    while (data.length <= index) data.push([]);
    return data[index];
  }

  return {
    _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((max, row) => Math.max(max, row.length), 0),
    appendRow(values) {
      data.push(values.slice());
    },
    deleteRow(row) {
      data.splice(row - 1, 1);
    },
    getRange(row, col, numRows, numCols) {
      const rows = numRows || 1;
      const cols = numCols || 1;
      return {
        getValue() {
          const line = data[row - 1];
          const value = line ? line[col - 1] : undefined;
          return value === undefined ? '' : value;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < rows; r += 1) {
            const line = [];
            for (let c = 0; c < cols; c += 1) {
              const source = data[row - 1 + r];
              const value = source ? source[col - 1 + c] : undefined;
              line.push(value === undefined ? '' : value);
            }
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          values.forEach((line, r) => {
            const target = ensureRow(row - 1 + r);
            line.forEach((value, c) => {
              target[col - 1 + c] = value;
            });
          });
          return this;
        },
      };
    },
  };
}

function createSpreadsheet() {
  const sheets = [];
  return {
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
    getSheets: () => sheets.slice(),
    insertSheet(name) {
      const sheet = createSheet(name);
      sheets.push(sheet);
      return sheet;
    },
    deleteSheet(sheet) {
      const index = sheets.indexOf(sheet);
      if (index >= 0) sheets.splice(index, 1);
    },
  };
}

/** SpreadsheetApp 전역을 설치하고 빈 스프레드시트를 돌려준다. */
function installSpreadsheetApp(id) {
  const spreadsheet = createSpreadsheet();
  global.SpreadsheetApp = {
    openById(requestedId) {
      if (requestedId !== id) throw new Error('알 수 없는 스프레드시트 ID: ' + requestedId);
      return spreadsheet;
    },
  };
  return spreadsheet;
}

module.exports = { createSheet, createSpreadsheet, installSpreadsheetApp };
```

- [ ] **Step 2: 실패하는 테스트 작성**

`test/sheet.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const { SHEETS } = require('../apps-script/schema');
const sheet = require('../apps-script/lib/sheet');

function freshSpreadsheet() {
  shim.resetShim();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  const spreadsheet = fake.installSpreadsheetApp(SPREADSHEET_ID);
  const users = spreadsheet.insertSheet('Users');
  users.appendRow(SHEETS.Users);
  return { spreadsheet, users };
}

test('SPREADSHEET_ID가 없으면 안내 메시지와 함께 예외를 던진다', () => {
  shim.resetShim();
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  assert.throws(() => sheet.readAll('Users'), /SPREADSHEET_ID/);
});

test('시트가 없으면 setupSheets 안내와 함께 예외를 던진다', () => {
  shim.resetShim();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  assert.throws(() => sheet.readAll('Users'), /setupSheets/);
});

test('헤더만 있는 시트는 빈 배열을 반환한다', () => {
  freshSpreadsheet();
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});

test('insert한 레코드를 기본키로 찾을 수 있다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동', email: 'a@b.com' });
  const found = sheet.findByPk('Users', 'U1');
  assert.strictEqual(found.name, '홍길동');
  assert.strictEqual(found.email, 'a@b.com');
});

test('정의되지 않은 열은 빈 문자열로 저장된다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동' });
  assert.strictEqual(sheet.findByPk('Users', 'U1').phone, '');
});

test('없는 기본키는 null을 반환한다', () => {
  freshSpreadsheet();
  assert.strictEqual(sheet.findByPk('Users', '없는키'), null);
});

test('findBy로 기본키가 아닌 열로도 찾을 수 있다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', email: 'a@b.com' });
  sheet.insert('Users', { user_id: 'U2', email: 'c@d.com' });
  assert.strictEqual(sheet.findBy('Users', 'email', 'c@d.com').user_id, 'U2');
  assert.strictEqual(sheet.findBy('Users', 'email', 'x@y.com'), null);
});

test('update는 지정한 열만 바꾸고 나머지를 보존한다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동', email: 'a@b.com' });
  sheet.update('Users', 'U1', { name: '김철수' });
  const found = sheet.findByPk('Users', 'U1');
  assert.strictEqual(found.name, '김철수');
  assert.strictEqual(found.email, 'a@b.com');
});

test('update는 기본키를 바꾸지 못한다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '홍길동' });
  sheet.update('Users', 'U1', { user_id: 'U999', name: '김철수' });
  assert.strictEqual(sheet.findByPk('Users', 'U999'), null);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '김철수');
});

test('upsert는 없으면 만들고 있으면 갱신한다', () => {
  freshSpreadsheet();
  sheet.upsert('Users', { user_id: 'U1', name: '처음' });
  sheet.upsert('Users', { user_id: 'U1', name: '나중' });
  assert.strictEqual(sheet.readAll('Users').length, 1);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '나중');
});

test('시트를 직접 편집해 행이 밀려도 올바른 레코드를 찾는다', () => {
  const { users } = freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째' });

  // 캐시에 U2의 행 번호를 채운다
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');

  // 관리자가 시트에서 첫 번째 데이터 행을 직접 지운 상황
  users.deleteRow(2);

  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');
  assert.strictEqual(sheet.findByPk('Users', 'U1'), null);
});

test('deleteByPk는 해당 행만 지운다', () => {
  freshSpreadsheet();
  sheet.insert('Users', { user_id: 'U1', name: '첫째' });
  sheet.insert('Users', { user_id: 'U2', name: '둘째' });
  assert.strictEqual(sheet.deleteByPk('Users', 'U1'), true);
  assert.strictEqual(sheet.deleteByPk('Users', '없는키'), false);
  assert.strictEqual(sheet.readAll('Users').length, 1);
  assert.strictEqual(sheet.findByPk('Users', 'U2').name, '둘째');
});

test('newId는 접두어를 붙인 고유 문자열을 만든다', () => {
  const a = sheet.newId('U');
  const b = sheet.newId('U');
  assert.match(a, /^U[0-9A-F]{12}$/);
  assert.notStrictEqual(a, b);
});
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/lib/sheet'`

- [ ] **Step 4: 시트 접근 계층 구현**

`apps-script/lib/sheet.js`:

```js
/**
 * Google Sheets 접근 계층.
 * 헤더 정의는 schema.js의 SHEETS를 따르며, 각 시트의 첫 열이 기본키다.
 */

var SHEET_CACHE_TTL_SEC = 300;

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error(
      'SPREADSHEET_ID 스크립트 속성이 설정되지 않았습니다. ' +
      '프로젝트 설정 > 스크립트 속성에서 대상 스프레드시트 ID를 등록하세요.'
    );
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('시트를 찾을 수 없습니다: ' + name + '. setupSheets()를 먼저 실행하세요.');
  }
  return sheet;
}

function headersOf_(name) {
  var headers = SHEETS[name];
  if (!headers) throw new Error('정의되지 않은 시트입니다: ' + name);
  return headers;
}

function rowToObject_(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] === undefined ? '' : row[i];
  }
  return obj;
}

function objectToRow_(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var value = obj[headers[i]];
    row.push(value === undefined || value === null ? '' : value);
  }
  return row;
}

/**
 * 기본키에 해당하는 행 번호를 찾는다. 없으면 0.
 * 캐시된 행 번호는 A열 값이 실제로 일치할 때만 사용한다.
 * 관리자가 시트를 직접 편집해 행이 밀렸을 수 있기 때문이다.
 */
function rowIndexOf_(name, pk) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'idx:' + name + ':' + pk;
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();

  var cached = cache.get(cacheKey);
  if (cached) {
    var cachedRow = parseInt(cached, 10);
    if (cachedRow >= 2 && cachedRow <= lastRow &&
        String(sheet.getRange(cachedRow, 1).getValue()) === pk) {
      return cachedRow;
    }
    cache.remove(cacheKey);
  }

  if (lastRow < 2) return 0;
  var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === pk) {
      var row = i + 2;
      cache.put(cacheKey, String(row), SHEET_CACHE_TTL_SEC);
      return row;
    }
  }
  return 0;
}

function readAll(name) {
  var headers = headersOf_(name);
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    out.push(rowToObject_(headers, values[i]));
  }
  return out;
}

function findByPk(name, pk) {
  var headers = headersOf_(name);
  var row = rowIndexOf_(name, String(pk));
  if (!row) return null;
  var values = getSheet_(name).getRange(row, 1, 1, headers.length).getValues()[0];
  return rowToObject_(headers, values);
}

function findBy(name, field, value) {
  var rows = readAll(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

function insert(name, obj) {
  var headers = headersOf_(name);
  getSheet_(name).appendRow(objectToRow_(headers, obj));
  return obj;
}

function update(name, pk, patch) {
  var headers = headersOf_(name);
  var key = String(pk);
  var row = rowIndexOf_(name, key);
  if (!row) return null;

  var sheet = getSheet_(name);
  var current = rowToObject_(headers, sheet.getRange(row, 1, 1, headers.length).getValues()[0]);
  for (var field in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      current[field] = patch[field];
    }
  }
  current[headers[0]] = key;

  sheet.getRange(row, 1, 1, headers.length).setValues([objectToRow_(headers, current)]);
  return current;
}

function upsert(name, obj) {
  var headers = headersOf_(name);
  var pk = String(obj[headers[0]]);
  return findByPk(name, pk) ? update(name, pk, obj) : insert(name, obj);
}

function deleteByPk(name, pk) {
  var key = String(pk);
  var row = rowIndexOf_(name, key);
  if (!row) return false;
  getSheet_(name).deleteRow(row);
  CacheService.getScriptCache().remove('idx:' + name + ':' + key);
  return true;
}

function newId(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

if (typeof module !== 'undefined') {
  global.SHEETS = require('../schema').SHEETS;
  module.exports = {
    readAll: readAll,
    findByPk: findByPk,
    findBy: findBy,
    insert: insert,
    update: update,
    upsert: upsert,
    deleteByPk: deleteByPk,
    newId: newId,
    getSheet_: getSheet_,
    getSpreadsheet_: getSpreadsheet_,
  };
}
```

의존성을 `global`에 직접 넣는 이유가 있다. Apps Script는 모든 파일을 하나의 전역 스코프에 이어 붙이므로 `schema.js`의 `SHEETS`가 이미 보인다. 반면 Node는 파일마다 스코프가 분리되어 `require`가 필요하다. 여기서 `var SHEETS = require(...)`로 쓰면 Apps Script에서 같은 이름을 다시 선언하게 되어 파일 로드 순서에 의존하는 위태로운 구조가 된다. `global`에 넣으면 Node에서는 이름이 해석되고 Apps Script에서는 이 블록 자체가 실행되지 않아 충돌이 생기지 않는다.

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 29 tests pass

행이 밀린 상황을 다루는 테스트가 특히 중요하다. 캐시 검증 로직이 빠지면 이 테스트가 잘못된 레코드를 반환한다.

- [ ] **Step 6: 커밋**

```bash
git add apps-script/lib/sheet.js test/sheet.test.js test/helpers/sheets-fake.js
git commit -m "feat: 시트 접근 계층과 행 인덱스 캐시"
```

---

### Task 5: 초기 구성 함수

`setupSheets`, `seedAdmin`, `resetAllSheets`를 만든다. 기존 데이터를 보존하는지가 핵심 검증 항목이다.

**Files:**
- Create: `apps-script/setup.js`
- Test: `test/setup.test.js`

**Interfaces:**
- Consumes: `SHEETS` (Task 2), `hashPassword` (Task 3), `insert`/`findBy`/`newId`/`getSpreadsheet_` (Task 4)
- Produces:
  - `setupSheets() -> { created: string[], extended: string[] }`
  - `seedAdmin(email, password, name?) -> { skipped: boolean, user_id?: string, reason?: string }`
  - `resetAllSheets(confirmation) -> { created: string[], extended: string[] }`
  - 상수 `RESET_CONFIRMATION`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/setup.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/gas-shim');
const fake = require('./helpers/sheets-fake');

shim.installGlobals();

const SPREADSHEET_ID = 'test-spreadsheet-id';
const { SHEETS } = require('../apps-script/schema');
const sheet = require('../apps-script/lib/sheet');
const hash = require('../apps-script/lib/hash');
const setup = require('../apps-script/setup');

function emptySpreadsheet() {
  shim.resetShim();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  return fake.installSpreadsheetApp(SPREADSHEET_ID);
}

test('setupSheets가 13개 시트를 헤더와 함께 만든다', () => {
  const spreadsheet = emptySpreadsheet();
  const result = setup.setupSheets();

  assert.strictEqual(result.created.length, 13);
  Object.keys(SHEETS).forEach((name) => {
    const created = spreadsheet.getSheetByName(name);
    assert.ok(created, `${name} 시트가 없다`);
    const headers = created.getRange(1, 1, 1, SHEETS[name].length).getValues()[0];
    assert.deepStrictEqual(headers, SHEETS[name], `${name}의 헤더가 다르다`);
  });
});

test('두 번 실행해도 시트가 중복 생성되지 않는다', () => {
  const spreadsheet = emptySpreadsheet();
  setup.setupSheets();
  const second = setup.setupSheets();

  assert.strictEqual(second.created.length, 0);
  assert.strictEqual(spreadsheet.getSheets().length, 13);
});

test('setupSheets는 기존 데이터를 지우지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '기존회원' });

  setup.setupSheets();

  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '기존회원');
});

test('헤더가 일부 빠진 시트에는 빠진 열만 뒤에 추가한다', () => {
  const spreadsheet = emptySpreadsheet();
  const users = spreadsheet.insertSheet('Users');
  users.appendRow(['user_id', 'name', 'email']);
  users.appendRow(['U1', '홍길동', 'a@b.com']);

  const result = setup.setupSheets();

  assert.ok(result.extended.some((entry) => entry.startsWith('Users:')));
  const headers = users.getRange(1, 1, 1, SHEETS.Users.length).getValues()[0];
  assert.deepStrictEqual(headers.slice(0, 3), ['user_id', 'name', 'email']);
  assert.strictEqual(new Set(headers).size, SHEETS.Users.length);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '홍길동');
});

test('seedAdmin이 검증 가능한 해시를 가진 관리자를 만든다', () => {
  emptySpreadsheet();
  setup.setupSheets();

  const result = setup.seedAdmin('admin@igm.co.kr', '초기비밀번호1234', '운영자');

  assert.strictEqual(result.skipped, false);
  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(admin.status, 'active');
  assert.strictEqual(admin.name, '운영자');
  assert.strictEqual(hash.verifyPassword('초기비밀번호1234', admin.password_hash), true);
  assert.strictEqual(hash.verifyPassword('틀린비밀번호', admin.password_hash), false);
});

test('seedAdmin은 비밀번호를 평문으로 남기지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('admin@igm.co.kr', '평문금지1234');

  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  assert.ok(!String(admin.password_hash).includes('평문금지1234'));
});

test('seedAdmin은 보관 만료일을 3년 뒤로 설정한다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('admin@igm.co.kr', '비밀번호1234');

  const admin = sheet.findBy('Users', 'email', 'admin@igm.co.kr');
  const created = new Date(admin.created_at);
  const retention = new Date(admin.retention_until);
  assert.strictEqual(retention.getFullYear() - created.getFullYear(), 3);
});

test('관리자가 이미 있으면 seedAdmin은 아무것도 하지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  setup.seedAdmin('first@igm.co.kr', '비밀번호1234');

  const result = setup.seedAdmin('second@igm.co.kr', '비밀번호1234');

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(sheet.findBy('Users', 'email', 'second@igm.co.kr'), null);
});

test('resetAllSheets는 확인 문자열 없이는 동작하지 않는다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '지워지면안됨' });

  assert.throws(() => setup.resetAllSheets(), /확인 문자열/);
  assert.throws(() => setup.resetAllSheets('아무거나'), /확인 문자열/);
  assert.strictEqual(sheet.findByPk('Users', 'U1').name, '지워지면안됨');
});

test('resetAllSheets는 확인 문자열이 맞으면 전부 비우고 다시 만든다', () => {
  emptySpreadsheet();
  setup.setupSheets();
  sheet.insert('Users', { user_id: 'U1', name: '지워짐' });

  const result = setup.resetAllSheets(setup.RESET_CONFIRMATION);

  assert.strictEqual(result.created.length, 13);
  assert.deepStrictEqual(sheet.readAll('Users'), []);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/setup'`

- [ ] **Step 3: 초기 구성 함수 구현**

`apps-script/setup.js`:

```js
/**
 * 시트 초기 구성. Apps Script 편집기에서 직접 실행한다.
 *
 * 실행 순서
 *   1. 프로젝트 설정 > 스크립트 속성에 SPREADSHEET_ID 등록
 *   2. setupSheets() 실행
 *   3. seedAdmin('관리자이메일', '초기비밀번호') 실행
 */

var RESET_CONFIRMATION = '모든데이터를삭제합니다';
var RETENTION_YEARS = 3;

/**
 * 없는 시트를 만들고 헤더를 채운다.
 * 이미 있는 시트는 빠진 헤더만 뒤에 덧붙이며, 기존 데이터는 절대 건드리지 않는다.
 */
function setupSheets() {
  var spreadsheet = getSpreadsheet_();
  var created = [];
  var extended = [];

  Object.keys(SHEETS).forEach(function (name) {
    var headers = SHEETS[name];
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      created.push(name);
      return;
    }

    var width = Math.max(sheet.getLastColumn(), headers.length);
    var existing = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
    while (existing.length && existing[existing.length - 1] === '') {
      existing.pop();
    }

    var missing = headers.filter(function (header) {
      return existing.indexOf(header) === -1;
    });

    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      extended.push(name + ': ' + missing.join(', '));
    }
  });

  return { created: created, extended: extended };
}

/** 최초 관리자 계정을 만든다. 이미 관리자가 있으면 아무것도 하지 않는다. */
function seedAdmin(email, password, name) {
  if (!email || !password) {
    throw new Error('seedAdmin(email, password, name) 형태로 이메일과 비밀번호를 넘겨야 합니다.');
  }

  var existing = findBy('Users', 'role', 'admin');
  if (existing) {
    return { skipped: true, reason: '이미 관리자 계정이 있습니다: ' + existing.email };
  }

  var now = new Date();
  var retention = new Date(now.getTime());
  retention.setFullYear(retention.getFullYear() + RETENTION_YEARS);

  var user = {
    user_id: newId('U'),
    name: name || '관리자',
    email: email,
    password_hash: hashPassword(password),
    phone: '',
    company: '',
    position: '',
    birth_date: '',
    role: 'admin',
    status: 'active',
    consent_at: now,
    retention_until: retention,
    created_at: now,
  };

  insert('Users', user);
  return { skipped: false, user_id: user.user_id };
}

/**
 * 전체 시트를 지우고 다시 만든다. 되돌릴 수 없다.
 * 확인 문자열이 정확히 일치할 때만 동작한다.
 */
function resetAllSheets(confirmation) {
  if (confirmation !== RESET_CONFIRMATION) {
    throw new Error(
      '확인 문자열이 일치하지 않습니다. resetAllSheets("' + RESET_CONFIRMATION + '") 형태로 호출하세요.'
    );
  }

  var spreadsheet = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (sheet) spreadsheet.deleteSheet(sheet);
  });

  return setupSheets();
}

if (typeof module !== 'undefined') {
  var sheetLib = require('./lib/sheet');
  global.SHEETS = require('./schema').SHEETS;
  global.getSpreadsheet_ = sheetLib.getSpreadsheet_;
  global.findBy = sheetLib.findBy;
  global.insert = sheetLib.insert;
  global.newId = sheetLib.newId;
  global.hashPassword = require('./lib/hash').hashPassword;

  module.exports = {
    RESET_CONFIRMATION: RESET_CONFIRMATION,
    setupSheets: setupSheets,
    seedAdmin: seedAdmin,
    resetAllSheets: resetAllSheets,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 39 tests pass

- [ ] **Step 5: 커밋**

```bash
git add apps-script/setup.js test/setup.test.js
git commit -m "feat: 시트 초기 구성과 관리자 계정 생성 함수"
```

---

### Task 6: clasp 연결과 실환경 검증

여기까지의 코드를 실제 Apps Script 프로젝트에 올려 동작을 확인하고, 해싱 반복 횟수를 실측해 확정한다.

**Files:**
- Create: `apps-script/appsscript.json`
- Create: `.clasp.json` (clasp가 생성)
- Modify: `apps-script/lib/hash.js` (측정 결과에 따라 `HASH_ITERATIONS` 조정)
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1~5의 모든 산출물
- Produces: 스크립트 속성 `SPREADSHEET_ID`가 설정되고 13개 시트와 관리자 계정 1건이 존재하는 실제 스프레드시트

- [ ] **Step 1: clasp 설치와 로그인**

```bash
npm install -g @google/clasp
```

이어서 `clasp login`을 실행하면 브라우저가 열린다. **LMS를 운영할 개인 Gmail 계정으로 로그인해야 한다.** 다른 계정으로 로그인하면 스크립트가 엉뚱한 계정에 생성된다.

로그인 전에 [script.google.com/home/usersettings](https://script.google.com/home/usersettings)에서 Apps Script API를 켜야 한다. 꺼져 있으면 clasp가 프로젝트를 만들지 못한다.

- [ ] **Step 2: 스프레드시트 생성과 ID 확보**

Google Drive에서 새 스프레드시트를 만들고 이름을 `IGM_LMS_DB`로 한다. 주소창의 `https://docs.google.com/spreadsheets/d/<여기가 ID>/edit`에서 ID를 복사해 둔다.

- [ ] **Step 3: Apps Script 매니페스트 작성**

`apps-script/appsscript.json`:

```json
{
  "timeZone": "Asia/Seoul",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

`executeAs`가 `USER_DEPLOYING`이므로 스크립트는 배포한 계정 권한으로 실행된다. 접근은 익명 허용이지만, 이후 태스크에서 만들 라우팅이 토큰 없는 요청을 모두 거부하므로 데이터는 보호된다.

- [ ] **Step 4: Apps Script 프로젝트 생성**

`apps-script` 폴더에서 실행한다.

```bash
clasp create --type standalone --title "IGM LMS API" --rootDir .
```

`.clasp.json`이 `apps-script/` 안에 생성된다. 저장소 루트로 옮기고 `rootDir`를 조정할 필요는 없다. 이 파일은 커밋한다.

- [ ] **Step 5: 코드 업로드**

```bash
clasp push
```

Expected: `schema.js`, `lib/hash.js`, `lib/sheet.js`, `setup.js`, `appsscript.json`이 올라갔다는 목록 출력

- [ ] **Step 6: 스크립트 속성 등록**

`clasp open`으로 편집기를 열고, 프로젝트 설정 화면의 스크립트 속성에 `SPREADSHEET_ID`와 Step 2에서 복사한 값을 등록한다.

- [ ] **Step 7: 시트 생성 확인**

편집기에서 `setupSheets` 함수를 선택해 실행한다. 첫 실행에는 권한 승인 화면이 뜬다.

Expected: 스프레드시트에 13개 탭이 생기고 각 탭 1행에 헤더가 채워진다. 실행 로그에 `created`가 13건으로 기록된다.

- [ ] **Step 8: 해싱 속도 측정**

편집기에서 `benchmarkHash` 함수를 실행하고 로그를 확인한다.

Expected: `10000회 해싱: <숫자>ms`

측정값이 1,000ms를 넘으면 `HASH_ITERATIONS`를 낮춘다. 예를 들어 2,500ms가 나왔다면 4,000회 정도가 1초 선에 들어온다. 반대로 300ms 이하로 여유가 크면 20,000회로 올린다. 목표는 로그인 응답을 1초 안에 유지하면서 반복 횟수를 최대화하는 것이다.

값을 조정했다면 `apps-script/lib/hash.js`의 상수를 고치고 `npm test`로 회귀를 확인한 뒤 `clasp push`한다.

- [ ] **Step 9: 관리자 계정 생성 확인**

편집기 콘솔에서 실행한다. 이메일과 비밀번호는 실제 사용할 값으로 바꾼다.

```js
seedAdmin('admin@igm.co.kr', '실제로쓸초기비밀번호', '운영자')
```

Expected: 반환값이 `{ skipped: false, user_id: 'U...' }`

Users 시트를 열어 `password_hash` 열이 `pbkdf2$`로 시작하고 비밀번호 원문이 어디에도 보이지 않는지 눈으로 확인한다.

- [ ] **Step 10: 데이터 보존 확인**

편집기에서 `setupSheets`를 한 번 더 실행한다.

Expected: 반환값의 `created`와 `extended`가 모두 빈 배열이고, Users 시트의 관리자 계정이 그대로 남아 있다.

- [ ] **Step 11: README 갱신**

`README.md`를 다음 내용으로 교체한다.

````markdown
# IGM_LMS

IGM 공개과정 e러닝 LMS. GitHub Pages(프론트) + Google Apps Script(API) + Google Sheets(DB) 구성이다.

## 문서

- 설계: `docs/superpowers/specs/2026-08-05-lms-design.md`
- 구현 계획: `docs/superpowers/plans/`

## 개발

```bash
npm test
```

```bash
cd apps-script && clasp push
```

`npm test`는 저장소 루트에서, `clasp push`는 `apps-script/` 안에서 실행한다. `.clasp.json`이 그 폴더에 있기 때문이다.

`apps-script/` 아래 코드는 clasp로 관리한다. 웹 편집기에서 직접 고치면 저장소와 어긋나므로, 수정은 항상 로컬에서 하고 `clasp push`로 올린다.

## 최초 구축 순서

1. 스프레드시트를 만들고 ID를 확인한다.
2. Apps Script 프로젝트 설정에서 스크립트 속성 `SPREADSHEET_ID`를 등록한다.
3. 편집기에서 `setupSheets()`를 실행해 13개 시트를 만든다.
4. `seedAdmin('이메일', '비밀번호')`로 최초 관리자 계정을 만든다.

`resetAllSheets()`는 전체 데이터를 삭제한다. 확인 문자열을 인자로 넘겨야만 동작하며, 운영 중에는 사용하지 않는다.

## 주의

- 교육생·임원 개인정보가 포함된 파일은 커밋하지 않습니다.
- 계정 정보, API 키 등은 `.env` 로 분리하며 `.gitignore` 에 의해 추적 대상에서 제외됩니다.
````

- [ ] **Step 12: 커밋**

```bash
git add apps-script/appsscript.json apps-script/.clasp.json apps-script/lib/hash.js README.md
git commit -m "chore: clasp 연결과 실환경 초기 구축"
git push
```

---

## 완료 기준

이 계획이 끝나면 다음이 모두 참이어야 한다.

- `npm test`가 39개 테스트를 통과한다.
- 실제 스프레드시트에 13개 시트가 헤더와 함께 존재한다.
- `setupSheets()`를 반복 실행해도 기존 데이터가 보존된다.
- 관리자 계정 1건이 있고, 비밀번호가 해시로만 저장되어 있으며 `verifyPassword`로 검증된다.
- `HASH_ITERATIONS`가 실측에 근거한 값으로 확정되어 있다.

## 다음 계획

- **2. 인증** — 라우팅과 권한 검사(`main.js`), 세션 발급·검증(`lib/session.js`), 회원가입·로그인 API, 프론트 통신 모듈과 로그인 화면. 완료 시 배포된 페이지에서 회원가입과 로그인이 동작한다.
- **3. 클래스·차시 관리** — 관리자 화면에서 클래스를 개설하고 차시를 등록한다.
- **4. 시청 측정** — 영상 플레이어, 이벤트 기반 전송, 서버 측 조작 검증.
- **5. 퀴즈와 집계** — 퀴즈 응시·채점, 재집계 트리거, 출결·수료 판정.
- **6. 수료증과 대시보드** — 수료증 PDF 발급, 관리자·강사 대시보드.

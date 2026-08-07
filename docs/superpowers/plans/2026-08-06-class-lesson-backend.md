# 클래스·차시 관리 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 `class.upsert`와 `lesson.upsert`로 클래스와 차시를 만들고, 회원이 `class.list`·`class.get`으로 조회하며, 시청 기록이 없는 차시만 `lesson.delete`로 지울 수 있는 상태를 만든다. 전 과정이 `doPost` 통합 테스트로 검증된다.

**Architecture:** 기존 라우팅 계층에 다섯 개 action을 얹는다. 순수 검증 로직은 `lib/validate.js`에 모으고, 클래스와 차시 핸들러는 각각 별도 파일로 둔다. 이 작업에서 라우팅 표에 `roles: ['admin']`이 처음 들어간다.

**Tech Stack:** Google Apps Script (V8), clasp, Node 내장 테스트 러너, 의존성 없음

설계 문서: `docs/superpowers/specs/2026-08-06-class-lesson-design.md`

## Global Constraints

- `apps-script/` 아래 코드는 `var` 선언만 쓰고 `import`/`export`와 화살표 함수를 쓰지 않는다. Apps Script가 모든 파일을 하나의 전역 스코프에 이어 붙이기 때문이다. (`assets/js/`는 정반대로 ES 모듈이다. 두 규칙을 섞지 않는다.)
- Node 호환은 파일 끝의 `if (typeof module !== 'undefined') { ... }` 블록으로 처리한다. 다른 파일의 함수는 이 블록 안에서 `global.X = require(...)` 형태로 주입한다. **`var X = require(...)`로 선언하면 Apps Script에서 같은 이름을 다시 선언하게 되어 파일 로드 순서에 의존하는 구조가 된다.**
- 시트 이름과 헤더는 `apps-script/schema.js`의 `SHEETS`가 유일한 출처다.
- 예상된 실패는 `appError_(code, message)`로 던진다. 그래야 ErrorLog에 기록되지 않고 사용자에게 그대로 전달된다. 코드에 없는 예외만 ErrorLog로 간다.
- 관리자 전용 action의 `roles`는 **반드시 배열**로 적는다(`['admin']`). 문자열로 적으면 `String.indexOf`가 부분 문자열을 찾아 조용히 통과시킨다. `main.js`에 배열 여부를 검사하는 방어가 이미 있어 요청은 막히지만, 애초에 배열로 적는다.
- 클래스 상태는 `모집중`, `진행중`, `종료` 셋뿐이다.
- 영상 URL은 `https`만 받는다.
- 외부 npm 의존성을 추가하지 않는다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps-script/lib/validate.js` | (수정) 기준값 범위·날짜 순서·HTTPS·상태 값·다음 차시 순서 검증 추가 |
| `apps-script/handlers/classes.js` | `class.list` · `class.get` · `class.upsert` |
| `apps-script/handlers/lessons.js` | `lesson.upsert` · `lesson.delete`, 차시 조회 헬퍼 |
| `apps-script/main.js` | (수정) 라우팅 표에 다섯 action 추가, `ADMIN_ONLY` 상수 |
| `test/classrules.test.js` | 새 검증 함수 단위 테스트 |
| `test/classes.test.js` | 클래스 핸들러 테스트 |
| `test/lessons.test.js` | 차시 핸들러 테스트 |
| `test/api.test.js` | (수정) 권한 통합 테스트 추가, 기존 임계값 테스트 보완 |

`lessonsOfClass_`는 `handlers/lessons.js`에 두고 `classes.js`가 쓴다. 차시에 관한 조회라 그쪽이 제자리다. `lessons.js`는 `classes.js`를 참조하지 않으므로 순환은 생기지 않는다.

---

### Task 1: 검증 함수 추가

Sheets에 의존하지 않는 판정 로직을 먼저 만든다. 이후 두 핸들러가 모두 이것을 쓴다.

**Files:**
- Modify: `apps-script/lib/validate.js`
- Test: `test/classrules.test.js`

**Interfaces:**
- Produces: `isHttpsUrl(value) -> boolean`, `isPercentInRange(value) -> boolean`, `isValidClassStatus(value) -> boolean`, `isValidDateRange(start, end) -> boolean`, `nextLessonOrder(lessons) -> number`, 상수 `CLASS_STATUSES`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/classrules.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `validate.isHttpsUrl is not a function`

- [ ] **Step 3: `apps-script/lib/validate.js`에 추가**

기존 함수 아래, `module.exports` 블록 위에 넣는다.

```js
var CLASS_STATUSES = ['모집중', '진행중', '종료'];

/**
 * 영상 주소는 https만 받는다. 사이트가 GitHub Pages(HTTPS)라
 * http 영상은 브라우저가 혼합 콘텐츠로 차단한다. 등록 시점에 막지 않으면
 * 수강생이 재생 버튼을 눌러야 비로소 드러난다.
 */
function isHttpsUrl(value) {
  if (value === undefined || value === null) return false;
  return /^https:\/\/\S+$/.test(String(value).trim());
}

/**
 * 출결 기준과 퀴즈 합격점은 0~100이어야 한다. 범위를 보지 않으면 120 같은 값이
 * 들어가 아무도 수료할 수 없는 클래스가 오류 없이 만들어진다.
 * 폼과 시트에서 문자열로 오므로 문자열 숫자도 허용한다.
 */
function isPercentInRange(value) {
  if (value === undefined || value === null) return false;
  if (String(value).trim() === '') return false;
  var num = Number(value);
  return !isNaN(num) && num >= 0 && num <= 100;
}

function isValidClassStatus(value) {
  return CLASS_STATUSES.indexOf(String(value)) !== -1;
}

/** 둘 중 하나라도 비어 있으면 통과로 본다. 기간 미정으로 클래스를 먼저 열 수 있다. */
function isValidDateRange(start, end) {
  if (!start || !end) return true;
  var from = new Date(start).getTime();
  var to = new Date(end).getTime();
  if (isNaN(from) || isNaN(to)) return false;
  return from <= to;
}

/** 기존 차시 목록에서 다음 순서 번호를 구한다. 값이 깨진 항목은 건너뛴다. */
function nextLessonOrder(lessons) {
  var max = 0;
  for (var i = 0; i < lessons.length; i++) {
    var order = Number(lessons[i].lesson_order);
    if (!isNaN(order) && order > max) max = order;
  }
  return max + 1;
}
```

`module.exports`에 `CLASS_STATUSES`, `isHttpsUrl`, `isPercentInRange`, `isValidClassStatus`, `isValidDateRange`, `nextLessonOrder`를 추가한다. 기존 export는 그대로 둔다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 159 tests pass (기존 150 + 신규 9)

**주의: 이 태스크는 리뷰 후 수정으로 테스트 2개가 더 붙어 161개로 끝났다(b5dbe74).
아래 태스크들의 예상 개수는 그 2개를 반영한 값이다.**

- [ ] **Step 5: 커밋**

```bash
git add apps-script/lib/validate.js test/classrules.test.js
git commit -m "feat: 클래스·차시 검증 함수"
```

---

### Task 2: 차시 핸들러

차시를 먼저 만든다. `classes.js`의 `class.get`이 차시 조회 헬퍼를 쓰기 때문이다.

**Files:**
- Create: `apps-script/handlers/lessons.js`
- Test: `test/lessons.test.js`

**Interfaces:**
- Consumes: `appError_` (lib/errors.js), `requireFields`·`isHttpsUrl`·`nextLessonOrder` (lib/validate.js), `readAll`·`findByPk`·`insert`·`update`·`deleteByPk`·`newId` (lib/sheet.js)
- Produces:
  - `lessonsOfClass_(classId) -> object[]` — `lesson_order` 다음 `lesson_id` 순 정렬
  - `watcherCount_(lessonId) -> number`
  - `handleLessonUpsert(payload, user) -> { lesson }`
  - `handleLessonDelete(payload, user) -> { deleted }`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/lessons.test.js`:

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
const lessons = require('../apps-script/handlers/lessons');

const ADMIN = { user_id: 'U-ADMIN', role: 'admin' };

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Classes', {
    class_id: 'C1', class_name: '리더십', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
}

function lessonPayload(over) {
  return Object.assign({
    class_id: 'C1',
    title: '1차시 오리엔테이션',
    video_url: 'https://cdn.example.com/1.mp4',
    video_duration_sec: 1800,
  }, over || {});
}

test('차시를 등록하면 순서가 1부터 붙는다', () => {
  fresh();
  const a = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const b = lessons.handleLessonUpsert(lessonPayload({ title: '2차시' }), ADMIN);
  const c = lessons.handleLessonUpsert(lessonPayload({ title: '3차시' }), ADMIN);

  assert.strictEqual(a.lesson.lesson_order, 1);
  assert.strictEqual(b.lesson.lesson_order, 2);
  assert.strictEqual(c.lesson.lesson_order, 3);
});

test('없는 클래스에는 차시를 붙일 수 없다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ class_id: 'NOPE' }), ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /클래스/);
    return true;
  });
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('http 영상 주소를 거부한다', () => {
  fresh();
  assert.throws(
    () => lessons.handleLessonUpsert(lessonPayload({ video_url: 'http://cdn.example.com/1.mp4' }), ADMIN),
    /https/
  );
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('영상 길이가 0 이하이거나 숫자가 아니면 거부한다', () => {
  fresh();
  [0, -5, 'abc'].forEach((bad) => {
    assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ video_duration_sec: bad }), ADMIN), /영상 길이/);
  });
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('필수 항목이 비면 무엇이 빠졌는지 알려준다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ title: '' }), ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /title/);
    return true;
  });
});

test('lesson_id를 주면 수정이고 새로 만들지 않는다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const updated = lessons.handleLessonUpsert(
    lessonPayload({ lesson_id: created.lesson.lesson_id, title: '고친 제목' }), ADMIN
  );

  assert.strictEqual(updated.lesson.lesson_id, created.lesson.lesson_id);
  assert.strictEqual(updated.lesson.title, '고친 제목');
  assert.strictEqual(sheet.readAll('Lessons').length, 1);
});

test('없는 lesson_id로 수정하면 새로 만들지 않고 거부한다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonUpsert(lessonPayload({ lesson_id: 'L-NOPE' }), ADMIN), /수정할 차시/);
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('차시의 소속 클래스는 바꿀 수 없다', () => {
  fresh();
  sheet.insert('Classes', {
    class_id: 'C2', class_name: '협상', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);

  assert.throws(
    () => lessons.handleLessonUpsert(lessonPayload({ lesson_id: created.lesson.lesson_id, class_id: 'C2' }), ADMIN),
    /소속 클래스/
  );
  assert.strictEqual(sheet.findByPk('Lessons', created.lesson.lesson_id).class_id, 'C1');
});

test('lessonsOfClass_는 순서대로 돌려주고 다른 클래스를 섞지 않는다', () => {
  fresh();
  sheet.insert('Classes', {
    class_id: 'C2', class_name: '협상', batch: '1기',
    watch_rate_threshold: 80, quiz_pass_score: 60, status: '모집중',
  });
  lessons.handleLessonUpsert(lessonPayload({ title: '1차시' }), ADMIN);
  lessons.handleLessonUpsert(lessonPayload({ title: '2차시' }), ADMIN);
  lessons.handleLessonUpsert(lessonPayload({ class_id: 'C2', title: '남의 차시' }), ADMIN);

  const list = lessons.lessonsOfClass_('C1');
  assert.deepStrictEqual(list.map((l) => l.title), ['1차시', '2차시']);
});

test('시청 기록이 없는 차시는 지울 수 있다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const result = lessons.handleLessonDelete({ lesson_id: created.lesson.lesson_id }, ADMIN);

  assert.strictEqual(result.deleted, created.lesson.lesson_id);
  assert.deepStrictEqual(sheet.readAll('Lessons'), []);
});

test('시청 기록이 있는 차시는 지울 수 없고 몇 명이 봤는지 알려준다', () => {
  fresh();
  const created = lessons.handleLessonUpsert(lessonPayload(), ADMIN);
  const lessonId = created.lesson.lesson_id;
  sheet.insert('WatchLogs', { watch_log_id: 'U1_' + lessonId, user_id: 'U1', lesson_id: lessonId, max_watched_sec: 10 });
  sheet.insert('WatchLogs', { watch_log_id: 'U2_' + lessonId, user_id: 'U2', lesson_id: lessonId, max_watched_sec: 20 });

  assert.throws(() => lessons.handleLessonDelete({ lesson_id: lessonId }, ADMIN), (err) => {
    assert.strictEqual(err.appCode, 'BAD_REQUEST');
    assert.match(err.message, /2명/);
    return true;
  });
  assert.strictEqual(sheet.readAll('Lessons').length, 1, '거부했으면 남아 있어야 한다');
});

test('없는 차시를 지우려 하면 거부한다', () => {
  fresh();
  assert.throws(() => lessons.handleLessonDelete({ lesson_id: 'L-NOPE' }, ADMIN), /차시를 찾을 수 없습니다/);
  assert.throws(() => lessons.handleLessonDelete({}, ADMIN), /차시를 지정/);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/handlers/lessons'`

- [ ] **Step 3: `apps-script/handlers/lessons.js` 구현**

```js
/**
 * 차시 핸들러. 라우팅과 권한 검사는 main.js가 하고 여기서는 내용만 다룬다.
 */

var LESSON_REQUIRED_FIELDS = ['class_id', 'title', 'video_url', 'video_duration_sec'];

/** 한 클래스의 차시를 순서대로 돌려준다. 순서가 같으면 lesson_id로 안정 정렬한다. */
function lessonsOfClass_(classId) {
  var all = readAll('Lessons');
  var target = String(classId);
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].class_id) === target) out.push(all[i]);
  }
  out.sort(function (a, b) {
    var left = Number(a.lesson_order);
    var right = Number(b.lesson_order);
    if (isNaN(left)) left = 0;
    if (isNaN(right)) right = 0;
    if (left !== right) return left - right;
    return String(a.lesson_id) < String(b.lesson_id) ? -1 : 1;
  });
  return out;
}

function watcherCount_(lessonId) {
  var logs = readAll('WatchLogs');
  var target = String(lessonId);
  var count = 0;
  for (var i = 0; i < logs.length; i++) {
    if (String(logs[i].lesson_id) === target) count += 1;
  }
  return count;
}

function handleLessonUpsert(payload, user) {
  var missing = requireFields(payload, LESSON_REQUIRED_FIELDS);
  if (missing.length) {
    throw appError_('BAD_REQUEST', '필수 항목이 비어 있습니다: ' + missing.join(', '));
  }

  var classId = String(payload.class_id).trim();
  if (!findByPk('Classes', classId)) {
    throw appError_('BAD_REQUEST', '클래스를 찾을 수 없습니다.');
  }

  if (!isHttpsUrl(payload.video_url)) {
    throw appError_('BAD_REQUEST',
      '영상 주소는 https로 시작해야 합니다. 사이트가 HTTPS라 http 영상은 브라우저가 차단합니다.');
  }

  var duration = Number(payload.video_duration_sec);
  if (isNaN(duration) || duration <= 0) {
    throw appError_('BAD_REQUEST', '영상 길이는 0보다 큰 값이어야 합니다.');
  }

  var lessonId = payload.lesson_id === undefined || payload.lesson_id === null
    ? '' : String(payload.lesson_id).trim();

  if (lessonId) {
    var existing = findByPk('Lessons', lessonId);
    // 없는 ID로 수정을 시도했을 때 새로 만들어 주면 오타가 데이터로 남는다.
    if (!existing) {
      throw appError_('BAD_REQUEST', '수정할 차시를 찾을 수 없습니다.');
    }
    if (String(existing.class_id) !== classId) {
      throw appError_('BAD_REQUEST', '차시의 소속 클래스는 바꿀 수 없습니다.');
    }

    var order = existing.lesson_order;
    if (payload.lesson_order !== undefined && String(payload.lesson_order).trim() !== '') {
      var requested = Number(payload.lesson_order);
      if (!isNaN(requested)) order = requested;
    }

    return { lesson: update('Lessons', lessonId, {
      title: String(payload.title).trim(),
      video_url: String(payload.video_url).trim(),
      video_duration_sec: duration,
      lesson_order: order,
    }) };
  }

  var record = {
    lesson_id: newId('L'),
    class_id: classId,
    lesson_order: nextLessonOrder(lessonsOfClass_(classId)),
    title: String(payload.title).trim(),
    video_url: String(payload.video_url).trim(),
    video_duration_sec: duration,
  };
  insert('Lessons', record);
  return { lesson: record };
}

function handleLessonDelete(payload, user) {
  var lessonId = payload.lesson_id === undefined || payload.lesson_id === null
    ? '' : String(payload.lesson_id).trim();
  if (!lessonId) {
    throw appError_('BAD_REQUEST', '차시를 지정해 주세요.');
  }
  if (!findByPk('Lessons', lessonId)) {
    throw appError_('BAD_REQUEST', '차시를 찾을 수 없습니다.');
  }

  var watchers = watcherCount_(lessonId);
  if (watchers > 0) {
    // 지우면 수강생의 학습 이력이 사라지고, 클래스 평균 시청률의 분모가 되는
    // 차시 수가 바뀌어 이미 내려진 수료 판정까지 달라진다.
    throw appError_('BAD_REQUEST',
      '이미 ' + watchers + '명이 시청한 차시라 삭제할 수 없습니다. ' +
      '지우면 수강 이력과 출결 계산이 함께 어긋납니다. ' +
      '정말 지워야 한다면 스프레드시트에서 직접 처리해 주세요.');
  }

  deleteByPk('Lessons', lessonId);
  return { deleted: lessonId };
}

if (typeof module !== 'undefined') {
  var sheetLib = require('../lib/sheet');
  var validateLib = require('../lib/validate');
  global.appError_ = require('../lib/errors').appError_;
  global.requireFields = validateLib.requireFields;
  global.isHttpsUrl = validateLib.isHttpsUrl;
  global.nextLessonOrder = validateLib.nextLessonOrder;
  global.readAll = sheetLib.readAll;
  global.findByPk = sheetLib.findByPk;
  global.insert = sheetLib.insert;
  global.update = sheetLib.update;
  global.deleteByPk = sheetLib.deleteByPk;
  global.newId = sheetLib.newId;

  module.exports = {
    lessonsOfClass_: lessonsOfClass_,
    watcherCount_: watcherCount_,
    handleLessonUpsert: handleLessonUpsert,
    handleLessonDelete: handleLessonDelete,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 173 tests pass (161 + 신규 12)

- [ ] **Step 5: 커밋**

```bash
git add apps-script/handlers/lessons.js test/lessons.test.js
git commit -m "feat: 차시 등록·수정·삭제 핸들러"
```

---

### Task 3: 클래스 핸들러

**Files:**
- Create: `apps-script/handlers/classes.js`
- Test: `test/classes.test.js`

**Interfaces:**
- Consumes: `appError_`, `requireFields`·`isPercentInRange`·`isValidClassStatus`·`isValidDateRange` (lib/validate.js), `readAll`·`findByPk`·`insert`·`update`·`newId` (lib/sheet.js), `lessonsOfClass_` (handlers/lessons.js), `publicUser_` (handlers/auth.js)
- Produces:
  - `handleClassList(payload, user) -> { classes }`
  - `handleClassGet(payload, user) -> { class, lessons, instructor }`
  - `handleClassUpsert(payload, user) -> { class }`
  - 상수 `VISIBLE_STATUSES`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/classes.test.js`:

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
const lessons = require('../apps-script/handlers/lessons');
const classes = require('../apps-script/handlers/classes');

const ADMIN = { user_id: 'U-ADMIN', role: 'admin' };
const STUDENT = { user_id: 'U-STU', role: 'student' };

function fresh() {
  shim.resetShim();
  sheet.resetSpreadsheetCache_();
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);
  fake.installSpreadsheetApp(SPREADSHEET_ID);
  setup.setupSheets();
  sheet.insert('Users', {
    user_id: 'U-INS', name: '김강사', email: 'ins@igm.co.kr',
    password_hash: 'pbkdf2$3000$aa$bb', role: 'instructor', status: 'active',
  });
  sheet.insert('Users', {
    user_id: 'U-STU', name: '홍길동', email: 'stu@igm.co.kr',
    password_hash: 'pbkdf2$3000$cc$dd', role: 'student', status: 'active',
  });
}

function classPayload(over) {
  return Object.assign({
    class_name: '리더십 과정',
    batch: '1기',
    watch_rate_threshold: 80,
    quiz_pass_score: 60,
  }, over || {});
}

test('클래스를 만들면 기본 상태가 모집중이다', () => {
  fresh();
  const result = classes.handleClassUpsert(classPayload(), ADMIN);
  assert.strictEqual(result.class.status, '모집중');
  assert.ok(result.class.class_id);
  assert.strictEqual(sheet.readAll('Classes').length, 1);
});

test('기준값이 0~100을 벗어나면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ watch_rate_threshold: 120 }), ADMIN), /출결 기준/);
  assert.throws(() => classes.handleClassUpsert(classPayload({ quiz_pass_score: -1 }), ADMIN), /퀴즈 합격/);
  assert.throws(() => classes.handleClassUpsert(classPayload({ watch_rate_threshold: '' }), ADMIN), /출결 기준/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('정의되지 않은 상태 값을 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ status: '대기' }), ADMIN), /모집중/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('시작일이 종료일보다 늦으면 거부한다', () => {
  fresh();
  assert.throws(
    () => classes.handleClassUpsert(classPayload({ start_date: '2026-05-01', end_date: '2026-04-01' }), ADMIN),
    /종료일/
  );
});

test('없는 담당 강사를 지정하면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ instructor_id: 'U-NOPE' }), ADMIN), /담당 강사를 찾을 수 없/);
});

test('강사도 관리자도 아닌 사용자는 담당 강사가 될 수 없다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ instructor_id: 'U-STU' }), ADMIN), /강사 또는 관리자/);
});

test('담당 강사를 비워두고 클래스를 열 수 있다', () => {
  fresh();
  const result = classes.handleClassUpsert(classPayload({ instructor_id: '' }), ADMIN);
  assert.strictEqual(result.class.instructor_id, '');
});

test('class_id를 주면 수정이고 새로 만들지 않는다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload(), ADMIN);
  const updated = classes.handleClassUpsert(
    classPayload({ class_id: created.class.class_id, class_name: '고친 이름', status: '진행중' }), ADMIN
  );

  assert.strictEqual(updated.class.class_id, created.class.class_id);
  assert.strictEqual(updated.class.class_name, '고친 이름');
  assert.strictEqual(updated.class.status, '진행중');
  assert.strictEqual(sheet.readAll('Classes').length, 1);
});

test('없는 class_id로 수정하면 새로 만들지 않고 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassUpsert(classPayload({ class_id: 'C-NOPE' }), ADMIN), /수정할 클래스/);
  assert.deepStrictEqual(sheet.readAll('Classes'), []);
});

test('학생에게는 종료된 클래스를 보여주지 않는다', () => {
  fresh();
  classes.handleClassUpsert(classPayload({ class_name: '열린 과정', status: '모집중' }), ADMIN);
  classes.handleClassUpsert(classPayload({ class_name: '진행 과정', status: '진행중' }), ADMIN);
  classes.handleClassUpsert(classPayload({ class_name: '끝난 과정', status: '종료' }), ADMIN);

  const forStudent = classes.handleClassList({}, STUDENT).classes.map((c) => c.class_name);
  const forAdmin = classes.handleClassList({}, ADMIN).classes.map((c) => c.class_name);

  assert.deepStrictEqual(forStudent.sort(), ['열린 과정', '진행 과정'].sort());
  assert.strictEqual(forAdmin.length, 3);
});

test('class.get은 클래스와 차시를 순서대로 함께 준다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ instructor_id: 'U-INS' }), ADMIN);
  const classId = created.class.class_id;
  lessons.handleLessonUpsert({ class_id: classId, title: '1차시', video_url: 'https://x/1.mp4', video_duration_sec: 600 }, ADMIN);
  lessons.handleLessonUpsert({ class_id: classId, title: '2차시', video_url: 'https://x/2.mp4', video_duration_sec: 900 }, ADMIN);

  const detail = classes.handleClassGet({ class_id: classId }, STUDENT);
  assert.strictEqual(detail.class.class_id, classId);
  assert.deepStrictEqual(detail.lessons.map((l) => l.title), ['1차시', '2차시']);
});

test('담당 강사 정보에 비밀번호 해시가 실리지 않는다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ instructor_id: 'U-INS' }), ADMIN);
  const detail = classes.handleClassGet({ class_id: created.class.class_id }, STUDENT);

  assert.strictEqual(detail.instructor.name, '김강사');
  assert.strictEqual(detail.instructor.password_hash, undefined);
  assert.strictEqual(JSON.stringify(detail).indexOf('pbkdf2'), -1);
});

test('학생은 종료된 클래스를 직접 조회할 수도 없다', () => {
  fresh();
  const created = classes.handleClassUpsert(classPayload({ status: '종료' }), ADMIN);
  assert.throws(() => classes.handleClassGet({ class_id: created.class.class_id }, STUDENT), /찾을 수 없/);
  assert.ok(classes.handleClassGet({ class_id: created.class.class_id }, ADMIN).class);
});

test('없는 클래스를 조회하면 거부한다', () => {
  fresh();
  assert.throws(() => classes.handleClassGet({ class_id: 'C-NOPE' }, ADMIN), /찾을 수 없/);
  assert.throws(() => classes.handleClassGet({}, ADMIN), /클래스를 지정/);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../apps-script/handlers/classes'`

- [ ] **Step 3: `apps-script/handlers/classes.js` 구현**

```js
/**
 * 클래스 핸들러. 라우팅과 권한 검사는 main.js가 하고 여기서는 내용만 다룬다.
 */

var CLASS_REQUIRED_FIELDS = ['class_name', 'batch'];

/** 관리자가 아닌 회원에게 보여줄 상태. 종료된 기수를 늘어놓을 이유가 없다. */
var VISIBLE_STATUSES = ['모집중', '진행중'];

function isVisibleToMember_(cls, user) {
  if (String(user.role) === 'admin') return true;
  return VISIBLE_STATUSES.indexOf(String(cls.status)) !== -1;
}

function handleClassList(payload, user) {
  var all = readAll('Classes');
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (isVisibleToMember_(all[i], user)) out.push(all[i]);
  }
  return { classes: out };
}

function handleClassGet(payload, user) {
  var classId = payload.class_id === undefined || payload.class_id === null
    ? '' : String(payload.class_id).trim();
  if (!classId) {
    throw appError_('BAD_REQUEST', '클래스를 지정해 주세요.');
  }

  var cls = findByPk('Classes', classId);
  // 목록에서 감춘 클래스를 직접 조회로 볼 수 있으면 감춘 의미가 없다.
  // 없는 것과 같은 문구를 쓴다.
  if (!cls || !isVisibleToMember_(cls, user)) {
    throw appError_('BAD_REQUEST', '클래스를 찾을 수 없습니다.');
  }

  var instructor = null;
  if (cls.instructor_id) {
    var row = findByPk('Users', cls.instructor_id);
    // 강사도 Users 행이라 그대로 내보내면 password_hash가 실린다.
    if (row) instructor = publicUser_(row);
  }

  return { class: cls, lessons: lessonsOfClass_(classId), instructor: instructor };
}

function handleClassUpsert(payload, user) {
  var missing = requireFields(payload, CLASS_REQUIRED_FIELDS);
  if (missing.length) {
    throw appError_('BAD_REQUEST', '필수 항목이 비어 있습니다: ' + missing.join(', '));
  }

  var status = payload.status === undefined || String(payload.status).trim() === ''
    ? '모집중' : String(payload.status).trim();
  if (!isValidClassStatus(status)) {
    throw appError_('BAD_REQUEST', '클래스 상태는 모집중, 진행중, 종료 중 하나여야 합니다.');
  }

  if (!isPercentInRange(payload.watch_rate_threshold)) {
    throw appError_('BAD_REQUEST', '출결 기준 시청률은 0에서 100 사이여야 합니다.');
  }
  if (!isPercentInRange(payload.quiz_pass_score)) {
    throw appError_('BAD_REQUEST', '퀴즈 합격 점수는 0에서 100 사이여야 합니다.');
  }
  if (!isValidDateRange(payload.start_date, payload.end_date)) {
    throw appError_('BAD_REQUEST', '운영 시작일이 종료일보다 늦을 수 없습니다.');
  }

  var instructorId = payload.instructor_id === undefined || payload.instructor_id === null
    ? '' : String(payload.instructor_id).trim();
  if (instructorId) {
    var instructor = findByPk('Users', instructorId);
    // 확인하지 않으면 오타 하나로 존재하지 않는 강사가 배정되고,
    // 강사 대시보드가 붙었을 때 그 클래스는 아무에게도 보이지 않는다.
    if (!instructor) {
      throw appError_('BAD_REQUEST', '지정한 담당 강사를 찾을 수 없습니다.');
    }
    var role = String(instructor.role);
    if (role !== 'instructor' && role !== 'admin') {
      throw appError_('BAD_REQUEST', '담당 강사는 강사 또는 관리자 역할이어야 합니다.');
    }
  }

  var record = {
    class_name: String(payload.class_name).trim(),
    batch: String(payload.batch).trim(),
    instructor_id: instructorId,
    start_date: payload.start_date || '',
    end_date: payload.end_date || '',
    watch_rate_threshold: Number(payload.watch_rate_threshold),
    quiz_pass_score: Number(payload.quiz_pass_score),
    quiz_retry_allowed: payload.quiz_retry_allowed === true,
    status: status,
  };

  var classId = payload.class_id === undefined || payload.class_id === null
    ? '' : String(payload.class_id).trim();

  if (classId) {
    // 없는 ID로 수정을 시도했을 때 새로 만들어 주면 오타가 데이터로 남는다.
    if (!findByPk('Classes', classId)) {
      throw appError_('BAD_REQUEST', '수정할 클래스를 찾을 수 없습니다.');
    }
    return { class: update('Classes', classId, record) };
  }

  record.class_id = newId('C');
  insert('Classes', record);
  return { class: record };
}

if (typeof module !== 'undefined') {
  var sheetLib = require('../lib/sheet');
  var validateLib = require('../lib/validate');
  global.appError_ = require('../lib/errors').appError_;
  global.requireFields = validateLib.requireFields;
  global.isPercentInRange = validateLib.isPercentInRange;
  global.isValidClassStatus = validateLib.isValidClassStatus;
  global.isValidDateRange = validateLib.isValidDateRange;
  global.readAll = sheetLib.readAll;
  global.findByPk = sheetLib.findByPk;
  global.insert = sheetLib.insert;
  global.update = sheetLib.update;
  global.newId = sheetLib.newId;
  global.lessonsOfClass_ = require('./lessons').lessonsOfClass_;
  global.publicUser_ = require('./auth').publicUser_;

  module.exports = {
    VISIBLE_STATUSES: VISIBLE_STATUSES,
    handleClassList: handleClassList,
    handleClassGet: handleClassGet,
    handleClassUpsert: handleClassUpsert,
  };
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 187 tests pass (173 + 신규 14)

- [ ] **Step 5: 커밋**

```bash
git add apps-script/handlers/classes.js test/classes.test.js
git commit -m "feat: 클래스 개설·조회·수정 핸들러"
```

---

### Task 4: 라우팅 등록과 권한 검증

다섯 action을 라우팅 표에 올린다. **여기서 `roles: ['admin']`이 처음 들어가고, 지금까지 한 번도 실행된 적 없던 역할 배열 검사 분기가 처음 돌게 된다.**

**Files:**
- Modify: `apps-script/main.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: Task 2·3의 다섯 핸들러
- Produces: 라우팅 표에 `class.list`·`class.get`·`class.upsert`·`lesson.upsert`·`lesson.delete`, 상수 `ADMIN_ONLY`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/api.test.js` 끝에 추가한다. 파일 상단의 `fresh()`, `post()`, `SIGNUP` 헬퍼를 그대로 쓴다. 먼저 그 헬퍼들을 읽어 실제 이름과 형태를 확인할 것.

```js
// 관리자 계정을 만들고 토큰을 얻는다. seedAdmin은 스크립트 속성을 쓰므로
// 여기서는 가입시킨 뒤 역할만 바꾸는 편이 간단하다.
// 다시 로그인할 필요는 없다. verifySession이 요청마다 Users 행을 새로 읽으므로
// 역할 변경이 기존 토큰에도 바로 반영된다.
function adminToken() {
  const signup = post('auth.signup', SIGNUP);
  sheet.update('Users', signup.data.user.user_id, { role: 'admin' });
  return signup.data.token;
}

function studentToken() {
  const payload = Object.assign({}, SIGNUP, { email: 'student@igm.co.kr' });
  return post('auth.signup', payload).data.token;
}

test('학생 토큰으로는 관리자 전용 action이 거부된다', () => {
  fresh();
  const token = studentToken();

  ['class.upsert', 'lesson.upsert', 'lesson.delete'].forEach((action) => {
    const response = post(action, {}, token);
    assert.strictEqual(response.ok, false, `${action}이 학생에게 통과했다`);
    assert.strictEqual(response.error.code, 'FORBIDDEN', `${action}의 오류 코드가 다르다`);
  });
});

test('관리자 토큰으로는 관리자 전용 action이 통과한다', () => {
  fresh();
  const token = adminToken();

  const created = post('class.upsert', {
    class_name: '리더십', batch: '1기', watch_rate_threshold: 80, quiz_pass_score: 60,
  }, token);

  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.data.class.status, '모집중');
});

test('회원이면 누구나 클래스 목록과 상세를 볼 수 있다', () => {
  fresh();
  const admin = adminToken();
  const created = post('class.upsert', {
    class_name: '리더십', batch: '1기', watch_rate_threshold: 80, quiz_pass_score: 60,
  }, admin).data.class;

  const student = studentToken();
  const list = post('class.list', {}, student);
  const detail = post('class.get', { class_id: created.class_id }, student);

  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.data.classes.length, 1);
  assert.strictEqual(detail.ok, true);
  assert.strictEqual(detail.data.class.class_id, created.class_id);
});

test('토큰 없이는 클래스 목록도 볼 수 없다', () => {
  fresh();
  const response = post('class.list', {});
  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.error.code, 'TOKEN_INVALID');
});

test('차시 등록과 삭제가 라우팅을 통해 동작한다', () => {
  fresh();
  const token = adminToken();
  const cls = post('class.upsert', {
    class_name: '리더십', batch: '1기', watch_rate_threshold: 80, quiz_pass_score: 60,
  }, token).data.class;

  const lesson = post('lesson.upsert', {
    class_id: cls.class_id, title: '1차시',
    video_url: 'https://cdn.example.com/1.mp4', video_duration_sec: 1800,
  }, token);
  assert.strictEqual(lesson.ok, true);
  assert.strictEqual(lesson.data.lesson.lesson_order, 1);

  const removed = post('lesson.delete', { lesson_id: lesson.data.lesson.lesson_id }, token);
  assert.strictEqual(removed.ok, true);
});

test('관리자 전용 라우트의 roles는 배열로 선언되어 있다', () => {
  const routes = main.routes_();
  ['class.upsert', 'lesson.upsert', 'lesson.delete'].forEach((action) => {
    assert.ok(Array.isArray(routes[action].roles), `${action}의 roles가 배열이 아니다`);
    assert.deepStrictEqual(routes[action].roles, ['admin']);
  });
});
```

그리고 기존 테스트 하나를 고친다. `guarded.length >= 3`이라는 개수 임계값은 보호 대상 action이 늘어나면 무의미해진다. 해당 줄을 다음으로 바꾼다.

```js
  // 보호 대상 action의 이름을 명시적으로 고정한다. 개수 임계값에 의존하면
  // 새 action을 추가하면서 하나를 실수로 PUBLIC으로 두어도 조용히 통과한다.
  assert.deepStrictEqual(guarded.sort(), [
    'auth.logout', 'auth.me', 'auth.updateProfile',
    'class.get', 'class.list', 'class.upsert',
    'lesson.delete', 'lesson.upsert',
  ].sort(), '보호 대상 action 목록이 바뀌었다. 새 action의 roles를 확인할 것');
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: FAIL — `class.upsert`가 `UNKNOWN_ACTION`을 반환하고, 보호 대상 목록 비교도 실패한다

- [ ] **Step 3: `apps-script/main.js` 수정**

`ANY_USER` 상수 아래에 추가한다.

```js
/**
 * 관리자 전용. 반드시 배열이어야 한다. 문자열로 적으면 String.indexOf가
 * 부분 문자열을 찾아 조용히 통과시킨다(main.js의 배열 검사가 막아주지만
 * 애초에 배열로 적는다).
 */
var ADMIN_ONLY = ['admin'];
```

`routes_()` 안의 표에 다섯 줄을 더한다.

```js
      'class.list':    { handler: handleClassList,    roles: ANY_USER },
      'class.get':     { handler: handleClassGet,     roles: ANY_USER },
      'class.upsert':  { handler: handleClassUpsert,  roles: ADMIN_ONLY },
      'lesson.upsert': { handler: handleLessonUpsert, roles: ADMIN_ONLY },
      'lesson.delete': { handler: handleLessonDelete, roles: ADMIN_ONLY },
```

`module` 블록에 주입을 더한다. 기존 `authHandlers` 주입 아래에 놓는다.

```js
  var classHandlers = require('./handlers/classes');
  global.handleClassList = classHandlers.handleClassList;
  global.handleClassGet = classHandlers.handleClassGet;
  global.handleClassUpsert = classHandlers.handleClassUpsert;

  var lessonHandlers = require('./handlers/lessons');
  global.handleLessonUpsert = lessonHandlers.handleLessonUpsert;
  global.handleLessonDelete = lessonHandlers.handleLessonDelete;
```

`routes_()`가 지연 평가 함수라 이 주입이 표보다 먼저 실행되기만 하면 된다. 표는 첫 호출 시점에 만들어진다.

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: 193 tests pass (187 + 신규 6)

- [ ] **Step 5: 권한 분기가 실제로 동작하는지 변이 검증**

이 분기는 이번에 처음 실행되는 코드다. 테스트가 진짜로 지키고 있는지 직접 확인한다.

`main.js`에서 역할 비교를 무력화한다.

```js
        if (false && route.roles.indexOf(String(user.role)) === -1) {
```

Run: `npm test`
Expected: `학생 토큰으로는 관리자 전용 action이 거부된다`가 실패한다.

원래대로 되돌리고 다시 `npm test`로 193개 통과를 확인한다. 실패하지 않았다면 테스트가 제 역할을 못 하는 것이므로 멈추고 보고할 것.

- [ ] **Step 6: 커밋**

```bash
git add apps-script/main.js test/api.test.js
git commit -m "feat: 클래스·차시 action 라우팅 등록

roles: ['admin']이 처음 들어가면서 지금까지 실행된 적 없던 역할 배열 검사
분기가 처음 돈다. 학생 토큰 거부와 관리자 통과를 테스트로 고정했다.

기존 '보호 대상 action이 토큰을 요구한다' 테스트가 개수 임계값에 의존해
새 action을 추가하면서 하나를 PUBLIC으로 두어도 통과할 수 있었다.
이름 목록 비교로 바꿨다."
```

---

## 완료 기준

- `npm test`가 193개 테스트를 통과하고 출력이 깨끗하다.
- 학생 토큰으로 관리자 전용 action을 부르면 `FORBIDDEN`, 관리자 토큰으로는 통과한다.
- 역할 비교를 무력화하면 그 테스트가 실제로 실패한다(Step 5에서 확인).
- 없는 `class_id`나 `lesson_id`로 수정을 시도하면 새로 만들지 않고 거부한다.
- 기준값 범위, 상태 값, 날짜 순서, HTTPS, 담당 강사 역할이 각각 검증된다.
- 차시를 연속 등록하면 순서가 1, 2, 3으로 붙는다.
- 시청 기록이 있는 차시는 삭제되지 않고, 몇 명이 시청했는지 알려준다.
- 학생에게는 종료된 클래스가 목록에도 상세 조회에도 나오지 않는다.
- `class.get` 응답 어디에도 `password_hash`가 없다.

## 다음 계획

**클래스·차시 관리 화면** — 관리자가 브라우저에서 클래스를 개설하고 차시를 등록하는 화면. 영상 URL을 붙여넣으면 브라우저가 메타데이터를 읽어 길이를 자동으로 채우는 부분이 여기 들어간다. 설계 문서 6장 참고.

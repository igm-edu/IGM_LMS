# Supabase 이전 검토

작성일: 2026-08-12
상태: **검토 문서. 아직 결정 전이며 코드는 건드리지 않았다.**
관련 문서: `2026-08-05-lms-design.md`, `2026-08-05-auth-design.md`, `2026-08-06-class-lesson-design.md`

이 문서의 목적은 "Supabase 무료 플랜으로 옮길 만한가"를 판단할 재료를 놓는 것이다.
Supabase 기준으로 데이터 모델과 접근 정책을 실제로 설계해 보고, 그 과정에서
**드러나는 함정과 이전 비용을 확인**한 뒤에 결정한다.

결론부터 적으면 옮길 값어치가 있다고 본다. 다만 무료라서 좋은 것이 아니라
**우리 설계의 제약 대부분이 Apps Script의 한도에서 나왔고 그게 사라지기 때문**이다.
동시에 지금 구조에 없던 종류의 위험이 새로 생긴다. 5장과 8장이 그 부분이다.

---

## 1. 무료 플랜 조건 (2026-08-12 확인)

| 항목 | Supabase Free | 우리 예상 사용량 |
|------|---------------|------------------|
| DB 용량 | 500 MB | 수강생 수백 명 규모의 텍스트 데이터. 여유 큼 |
| 인증 | 월 활성 사용자 50,000명 | 많아야 수백 명 |
| 파일 저장소 | 1 GB | **사용 안 함** (영상은 기존 mp4 직링크 서버) |
| 송신 대역폭 | 5 GB | JSON만 오감. 영상이 빠지므로 여유 큼 |
| API 호출 | 무제한 | — |
| 프로젝트 | 활성 2개 | 1개 |
| **일시정지** | **1주일 미사용 시** | **8장에서 다룬다. 실제로 걸릴 수 있다** |

영상이 이 플랫폼을 지나가지 않는다는 점이 핵심이다. 무료 플랜이 무너지는
전형적인 지점(저장소·대역폭)을 처음부터 비켜 간다.

Firebase Spark를 함께 봤으나 두 가지 이유로 제외했다. Cloud Functions를 아예
배포할 수 없어 수료 판정 같은 서버 로직을 둘 곳이 없고(클라이언트가 자기
수료 여부를 계산하게 된다), 하루 쓰기 2만 건 상한이 시청 진도처럼 잦은
쓰기와 맞지 않는다. 데이터도 관계형이라 Postgres 쪽이 맞다.

---

## 2. 데이터 모델 (13개 시트 → Postgres)

기본키는 전부 `uuid`(`gen_random_uuid()`)로 바꾼다. 지금의 `U`/`C` 접두어 문자열
ID는 시트에서 사람이 읽으려고 만든 것이라 목적이 사라진다. 예외는
`certificates.certificate_no`로, 이건 사람에게 발급하는 번호라 별도 시퀀스로 남긴다.

| 현재 시트 | Postgres | 비고 |
|-----------|----------|------|
| Users | `auth.users` + `public.profiles` | 3장에서 분리 설명 |
| Sessions | **삭제** | Supabase Auth가 JWT·리프레시 토큰으로 처리 |
| Classes | `classes` | |
| Enrollments | `enrollments` | `unique (user_id, class_id)` |
| Lessons | `lessons` | |
| WatchLogs | `watch_logs` | `unique (user_id, lesson_id)` |
| Quizzes | `quizzes` | |
| QuizQuestions | `quiz_questions` + **`quiz_answer_keys`** | 5.4에서 이유 설명 |
| QuizAttempts | `quiz_attempts` | |
| QuizAnswers | `quiz_answers` | |
| Attendance | `attendance` | 뷰로 대체 가능한지는 6장 |
| Certificates | `certificates` | |
| ErrorLog | `error_log` | 애플리케이션 오류용으로 유지 |

### 2.1 코드가 제약으로 바뀌는 부분

지금까지 리뷰에서 잡은 결함 중 상당수가 "검사를 빠뜨리면 조용히 잘못된 값이
들어가는" 종류였다. 그 검사들이 DB 제약으로 내려가면 빠뜨릴 수가 없어진다.
아래는 각각 우리가 실제로 겪은 사건과 대응된다.

| 제약 | 대체하는 코드 | 관련 사건 |
|------|---------------|-----------|
| `email citext unique` | `normalizeEmail` + 중복 검사 | **2026-08-12 로그인 버그가 구조적으로 불가능해진다** |
| `check (watch_rate_threshold between 0 and 100)` | `isPercentInRange` | 불리언 `false`가 통과해 출결 기준이 0%가 되던 건 |
| `check (quiz_pass_score between 0 and 100)` | 위와 동일 | |
| `check (status in ('모집중','진행중','종료'))` | `isValidClassStatus` | |
| `check (video_url like 'https://%')` | `isHttpsUrl` | 혼합 콘텐츠 차단 |
| `check (end_date >= start_date)` | `isValidDateRange` | |
| `check (lesson_order >= 1)` | 차시 순서 검증 | 순서에 숫자 아닌 값이 조용히 무시되던 건 |
| 외래키 전반 | "없는 class_id/lesson_id" 검사 | classes·lessons 핸들러의 존재 확인 로직 |
| `watch_logs.lesson_id` 참조 `on delete restrict` | 삭제 거부 로직 | 설계 8장의 "시청한 차시는 삭제 불가" |

**주의: `(class_id, lesson_order)`에 유니크 제약을 걸면 안 된다.** 설계 7장이
3번과 5번을 맞바꾸는 중간 상태를 허용하기로 했기 때문이다. 이건 이전할 때
반사적으로 유니크를 붙이기 쉬운 자리라 미리 적어 둔다.

### 2.2 경합 해소

리뷰에서 "고치지 않고 기록만" 한 `update()`의 read-merge-write 경합이 사라진다.
Postgres의 `update ... set col = value`는 지정한 열만 바꾸므로 두 관리자가 서로
다른 필드를 고쳐도 덮어쓰지 않는다. LockService로 모든 쓰기를 직렬화해야 했던
이유가 90분 예산이었는데, 그 예산 자체가 없어진다.

---

## 3. 인증

`auth.users`는 Supabase가 소유한다. 이메일, 비밀번호 해시, 이메일 확인 여부,
마지막 로그인 시각이 여기 있다. 우리 도메인 정보는 `public.profiles`에 두고
`id uuid primary key references auth.users(id) on delete cascade`로 잇는다.

없어지는 코드는 이렇다. `lib/hash.js`(직접 구현한 PBKDF2), `lib/session.js`,
`lib/ratelimit.js`, `handlers/auth.js`의 가입·로그인·로그아웃, 그리고 이들을
검증하던 테스트 상당수다.

- **해싱 3,000회 문제가 사라진다.** OWASP 권고의 1/200 수준으로 낮춘 것은
  실행시간 90분 한도 때문이었다. Supabase Auth는 정식 구현을 쓴다.
- **비밀번호 재설정·이메일 확인이 공짜로 생긴다.** 지금은 범위 밖으로 미뤄둔 기능이다.
- **응답 시간에 의한 계정 열거**(auth-design 9.1에서 감수하기로 한 위험)를
  다시 검토할 수 있다. 더미 해시를 못 넣은 이유가 90분 예산이었기 때문이다.

**행동이 달라지는 지점 하나.** 우리가 설계한 단계적 잠금(10분 → 1시간 → 6시간)은
그대로 재현되지 않는다. Supabase Auth의 기본 제한은 계정별 누진이 아니라
IP·전역 기준이다. 이 차이를 받아들일지, 아니면 별도 테이블과 함수로 다시
구현할지 결정해야 한다. 원래 누진 잠금을 택한 이유가 "유효한 이메일 6개면
하루 예산을 소진시켜 LMS를 멈출 수 있다"였는데 **그 공격 자체가 성립하지
않게 되므로**, 기본 제한을 그대로 쓰는 쪽이 맞다고 본다.

**이메일을 profiles에도 둘지.** 관리자 화면에서 회원 목록에 이메일을 보여줘야
하는데 `auth.users`는 직접 조회할 수 없다. 트리거로 `profiles.email`에 미러링하는
방식을 권한다. 조회가 단순해지고 RLS도 그대로 적용된다. 대신 **동기화 의무가
생기므로** 이메일 변경 경로를 만들 때 트리거를 반드시 함께 점검해야 한다.

---

## 4. 프론트엔드

빌드 단계 없이 그대로 간다. `@supabase/supabase-js`를 ESM CDN에서 불러오면
현재의 no-build·no-npm 원칙이 유지된다.

지금 프론트에서 없어지는 것은 `assets/js/api.js`의 우회 처리들이다. Apps Script가
CORS 사전 요청에 응답하지 못해 `Content-Type: text/plain`으로 보내고 토큰을
본문에 싣던 구조, 그리고 항상 HTTP 200이 오므로 본문의 `ok`를 봐야 했던 규칙이
전부 사라진다. Supabase는 정상적인 REST라 상태 코드와 헤더를 그대로 쓴다.

`index.html`과 `assets/css/style.css`는 그대로 살아남는다.

---

## 5. 접근 제어 (RLS) — 가장 주의할 부분

여기가 이번 검토에서 가장 값어치 있는 부분이다. **Apps Script에서는 코드가
서버에만 있어서 실수해도 노출 범위가 좁았지만, Supabase는 테이블 구조가 곧
API이고 공개 키가 프론트에 박힌다.** 정책 하나를 잘못 쓰면 수강생 개인정보가
통째로 열린다. 설계해 보니 함정이 네 개 나왔다.

### 5.1 역할 조회의 재귀 함정

역할은 `profiles.role`에 있는데, `profiles`에도 RLS가 걸린다. 정책 안에서
`profiles`를 다시 조회하면 무한 재귀가 난다. `security definer` 함수로 감싸고
`search_path`를 고정하는 것이 정석이다.

```sql
create function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
```

### 5.2 RLS는 행 단위이지 열 단위가 아니다

이게 우리 설계와 정면으로 부딪힌다. auth-design 9.2는 본인이 고칠 수 있는
필드를 다섯 개로 제한하고 `role`·`status`는 관리자만 바꾸게 했는데,
**RLS로는 "이 행은 수정 가능하되 이 열은 안 됨"을 표현할 수 없다.**
`grant update (name, phone, company, position, birth_date) on profiles to authenticated`
처럼 열 권한을 따로 주거나 BEFORE UPDATE 트리거로 막아야 한다.
빠뜨리면 **수강생이 자기 role을 admin으로 바꿀 수 있다.**

### 5.3 필드 숨김도 마찬가지

`profiles`를 그냥 열어주면 `birth_date`(수료증 전용)와 동의 기록까지 나간다.
지금은 `publicUser_` 화이트리스트가 막고 있는데, PostgREST에는 그런 층이 없다.
열 권한이나 뷰로 다시 만들어야 한다.

### 5.4 퀴즈 정답이 클라이언트로 간다

**가장 위험한 항목이다.** `quiz_questions`에는 `correct_option`이 들어 있고
수강생은 문제를 읽어야 하므로 이 테이블에 읽기 권한이 필요하다. 그러면
정답도 함께 내려간다. 지금은 Apps Script 핸들러가 응답 모양을 정해서
막히지만 PostgREST는 테이블이 곧 응답이다.

정답을 `quiz_answer_keys` 별도 테이블로 분리하고 수강생에게는 권한을 주지
않는다. 채점은 `security definer` 함수로 서버에서 하고 점수만 돌려준다.
어차피 점수를 클라이언트가 계산하게 두면 안 되므로 함께 해결된다.
**2장의 테이블 목록에 이 분리를 이미 반영해 두었다.**

### 5.5 정책 개요

| 테이블 | 수강생 | 강사 | 관리자 |
|--------|--------|------|--------|
| profiles | 본인 조회·수정(열 제한) | 본인 | 전체 |
| classes | 조회 | 담당 클래스 | 전체 |
| lessons | 수강 중인 클래스만 조회 | 담당 클래스 | 전체 |
| watch_logs | 본인 조회·기록 | 담당 클래스 조회 | 전체 |
| quiz_questions | 조회(정답 제외) | 담당 클래스 | 전체 |
| quiz_answer_keys | **없음** | 담당 클래스 | 전체 |
| quiz_attempts | 본인 조회, 제출은 함수로만 | 담당 클래스 조회 | 전체 |
| attendance / certificates | 본인 조회 | 담당 클래스 조회 | 전체 |

**시청 기록의 신뢰 문제는 지금과 같다.** 브라우저가 보고하는 값을 믿는 구조라
수강생이 조작할 수 있다. 이전으로 나빠지지도 나아지지도 않으니, 개선하려면
별도 과제로 다뤄야 한다.

---

## 6. 집계

상위 설계에서 "B안 — 집계 분리"를 택한 이유가 시트에서 집계가 비싸기 때문이었다.
Postgres에서는 뷰나 함수로 즉시 계산할 수 있다. 클래스별 시청률, 퀴즈 합격 여부,
수료 판정이 전부 SQL 한 덩어리다.

그러면 `attendance` 테이블을 아예 없애고 뷰로 대체할 수 있는지가 남는데,
**수료 시점의 판정 기준을 보존해야 하므로 테이블을 유지하는 쪽을 권한다.**
클래스의 출결 기준이 나중에 바뀌면 이미 발급한 수료증의 근거가 흔들린다.
수료 확정 시점에 그때의 값을 찍어 두는 편이 안전하다.

---

## 7. 이전 비용

### 버려지는 것

`apps-script/` 전체다. `lib/hash.js`, `lib/session.js`, `lib/ratelimit.js`,
`lib/sheet.js`, `schema.js`, `setup.js`, `main.js`, `handlers/` 세 개.
그리고 `test/helpers/gas-shim.js`, `test/helpers/sheets-fake.js`와
없어질 계층을 검증하던 테스트들. 213개 중 순수 검증 로직(`validate.js` 계열)
정도만 살아남고 나머지는 DB 제약과 RLS 정책 테스트로 성격이 바뀐다.

### 남는 것

설계 문서 세 개(도메인 규칙·상태 값·부분 수정 규칙·시청률 측정 방식),
`index.html`, `assets/css/style.css`, 그리고 그동안 내린 판단의 기록.
**도메인 지식은 그대로 살아남으므로 처음부터 다시 하는 것이 아니다.**

### 단계

1. 프로젝트 생성(서울 리전), 스키마 마이그레이션 SQL 작성 — 2장이 초안
2. RLS 정책과 `security definer` 함수 작성 — 5장의 함정 네 개 포함
3. 정책 검증 테스트. **수강생 토큰으로 남의 데이터를 못 읽는지 실제로 확인한다.**
   여기는 변이 검증을 반드시 돌린다. 정책을 하나 지웠을 때 그 테스트가
   실패하지 않으면 검증이 헛돈 것이다
4. 프론트 통신 계층 교체
5. 관리자 화면 (원래 다음 작업)

1~4가 오늘 수준으로 되돌아오는 데 두세 세션으로 본다. 그대로 갔을 때
관리자 화면만 한두 세션이므로, **순비용은 한두 세션 정도이고 그 이후는
계속 빨라진다.**

---

## 8. 위험

**1주일 미사용 시 일시정지.** 기수 사이에 공백이 생기는 공개과정 특성상 실제로
걸린다. "교육 시작일 아침에 사이트가 죽어 있다"가 가능한 시나리오다.
대시보드에서 복구되지만 시간이 걸리므로, 하루 한 번 깨우는 장치를 처음부터
넣어야 한다. GitHub Actions 스케줄로 가벼운 요청을 보내면 된다.

**RLS 실수의 파급.** 5장이 이 얘기다. 공개 키가 프론트에 있으므로 정책이
곧 유일한 방어선이다. Apps Script에서는 없던 종류의 부담이고, 3단계 검증을
형식적으로 하면 안 되는 이유다.

**개인정보.** 서울 리전을 고르면 데이터는 국내에 남는다. 다만 Supabase는
해외 사업자이므로 위탁·이전에 관한 회사 내부 규정 확인이 필요할 수 있다.
**이건 내가 판단할 수 없는 영역이다.**

**무료 플랜 조건 변경.** 지금 조건이 유지된다는 보장은 없다. 다만 데이터가
표준 Postgres라 `pg_dump`로 통째로 빼낼 수 있어 종속이 약하다. 시트에 묶여
있는 지금보다 오히려 빠져나가기 쉽다.

**계정 관리.** 스프레드시트 ID를 스크립트 속성에만 두었던 것과 같은 원칙이
필요하다. `service_role` 키는 절대 저장소에 들어가면 안 된다. 공개 키(anon)는
프론트에 두는 것이 정상 설계다.

---

## 9. 결정에 필요한 것

1. **회사 규정상 외부 SaaS에 교육생 개인정보를 둘 수 있는가.** 서울 리전이라
   국내에 남지만 사업자는 해외다. 확인이 필요하다.
2. 단계적 잠금을 Supabase 기본 제한으로 대체해도 되는지 (3장). 그렇다고 본다.
3. 지금 스프레드시트에 든 데이터를 옮길지, 새로 시작할지. 아직 실운영
   데이터가 거의 없다면 새로 시작하는 편이 깔끔하다.

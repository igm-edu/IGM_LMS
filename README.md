# IGM_LMS

IGM 공개과정 e러닝 LMS. GitHub Pages(프론트) + Supabase(인증·DB) 구성이다.
영상은 기존 mp4 직링크 서버에 두고 이 시스템을 거치지 않는다.

라이브: https://igm-edu.github.io/IGM_LMS/

## 문서

- 설계: `docs/superpowers/specs/`
- Supabase 이전 검토: `docs/superpowers/specs/2026-08-12-supabase-migration-review.md`
- DB 설정과 실행 순서: `supabase/README.md`

2026-08-12 이전에는 Google Apps Script + Google Sheets 였다. 그 시절의 설계
문서는 `docs/` 에 그대로 두었다. 도메인 규칙은 지금도 유효하고, 어떤 판단을
왜 했는지가 남아 있기 때문이다. 다만 **7장의 해싱 3,000회 같은 기술 제약은
Apps Script 한도에서 나온 것이라 지금은 해당되지 않는다.**

## 구조

```
assets/js/config.js   Supabase 주소와 공개 키
assets/js/api.js      통신 계층. 세션 보관과 토큰 갱신
assets/js/auth.js     가입·로그인·프로필
assets/js/main.js     화면 전환과 폼 처리
supabase/migrations/  스키마·RLS 정책·서버 함수 (SQL)
test/                 Node 내장 러너
```

빌드 단계가 없다. `index.html` 을 열면 그대로 동작한다.

## 개발

```bash
npm test
```

외부 의존성 없이 Node 내장 테스트 러너만 쓴다. 브라우저 API(`fetch`,
`localStorage`)는 `test/helpers/browser-shim.js` 의 메모리 대역으로 대신한다.

**공식 `supabase-js` 를 쓰지 않는다.** 빌드 단계도 npm 의존성도 두지 않기로
했고, CDN 에서 스크립트를 받으면 제3자가 개인정보를 다루는 페이지에 임의의
코드를 실행시킬 수 있다. 쓰는 범위가 인증과 REST 조회뿐이라 직접 만드는 편이
검증하기도 쉽다. 대신 **토큰 갱신을 직접 책임진다.** `api.js` 의 갱신 경로가
이 저장소에서 가장 조심해야 할 부분이다.

## 배포

`main` 에 푸시하면 GitHub Pages 가 1~2분 안에 반영한다. 별도 배포 명령이 없다.

DB 변경은 `supabase/migrations/` 에 SQL 파일을 추가하고 대시보드의 SQL Editor
에서 실행한다. 마이그레이션은 덧붙이기만 하고 기존 파일은 고치지 않는다.
이미 실행된 파일을 고치면 새로 까는 환경과 지금 환경이 달라진다.

**배포 직후 10분간 주의.** GitHub Pages 가 정적 파일에 `max-age=600` 을 준다.
그 사이 재방문한 브라우저는 예전 파일과 새 파일을 섞어 쓸 수 있다. 모듈 간
계약(export 이름 등)을 바꾸는 배포에서는 실제로 깨진다. 저절로 풀리지만,
운영 중이라면 import 경로에 버전 문자열을 붙이는 식의 대응이 필요하다.

## 접근 제어

이 저장소는 공개이고 Supabase 공개 키가 `config.js` 에 들어 있다.
**접근 제어는 전적으로 RLS 정책이 담당한다.** 정책 하나를 잘못 쓰면 수강생
개인정보가 통째로 열린다. `supabase/migrations/002_security.sql` 을 고칠 때는
반드시 수강생 토큰으로 직접 두드려 확인한다. 확인 방법과 지난 결과는
`.superpowers/sdd/progress-supabase.md` 에 있다.

특히 다음 네 가지는 설계할 때 놓치기 쉬워 주석으로 이유를 남겨 두었다.

- 정책 안에서 `profiles` 를 조회하면 무한 재귀가 난다. `security definer` 로 감싼다.
- **RLS 는 행 단위다.** 열 제한은 `grant update (열목록)` 으로 따로 해야 한다.
- 열 권한은 로그인한 모두에게 같이 적용된다. 관리자도 예외가 아니라서
  역할·상태 변경은 `003_rpc.sql` 의 전용 함수로만 한다.
- **테이블 구조가 곧 API 다.** 퀴즈 정답이 문제와 같은 행에 있으면 그대로
  내려간다. `quiz_answer_keys` 를 분리한 이유다.

## 주의

- 교육생·임원 개인정보가 포함된 파일은 커밋하지 않는다.
- `sb_secret_...` 키와 DB 비밀번호는 RLS 를 전부 우회한다. **저장소 폴더 안에
  두지 않는다.** `.gitignore` 로 막아 두었지만 무시 규칙은 마지막 방어선이지
  보관 장소의 허가가 아니다.
- Project URL 과 `sb_publishable_...` 키는 공개해도 된다. 브라우저에 실리는
  것을 전제로 만들어진 값이다.

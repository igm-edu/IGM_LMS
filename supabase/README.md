# Supabase 설정

프로젝트: `djaooyyyiwqaewyirdvq` (Seoul, Free)

## 실행 순서

Supabase 대시보드 > SQL Editor 에서 아래 순서대로 **한 파일씩** 붙여넣어 실행한다.

1. `migrations/001_schema.sql` — 테이블과 제약
2. `migrations/002_security.sql` — RLS 정책, 권한, 트리거
3. `migrations/003_rpc.sql` — 관리자 전용 함수
4. `migrations/004_watch_log_delete.sql` — 시청 기록 삭제 권한 (002의 누락 보완)
5. `migrations/005_lesson_url_duration.sql` — 영상 주소·길이를 함께 바꾸게 강제
6. `migrations/006_recalc_watch_rate.sql` — 영상 길이가 바뀌면 시청률 재계산

**001만 실행한 상태로 두지 말 것.** 그 사이에는 RLS가 꺼져 있어 테이블이
공개 상태다. 세 파일을 연달아 실행한다.

각 파일은 여러 번 실행하도록 만들지 않았다. 다시 깔아야 하면 대시보드에서
프로젝트를 초기화하거나 테이블을 지우고 001부터 다시 한다.

## 첫 관리자 만들기

역할 변경은 관리자만 할 수 있으므로 첫 관리자는 SQL로 직접 만든다.
비밀번호는 본인이 화면에서 입력하는 것이라 이 저장소에 남지 않는다.

1. 사이트에서 평소처럼 회원가입한다 (역할은 student 로 시작한다)
2. SQL Editor 에서 실행:

```sql
update public.profiles set role = 'admin' where email = '본인이메일@igm.co.kr';
```

이후의 역할 변경은 관리자 화면에서 `admin_set_user_role()` 로 한다.

## 키 구분

| 키 | 위치 | 성격 |
|----|------|------|
| Project URL | `assets/js/config.js` | 공개 |
| publishable key (`sb_publishable_...`) | `assets/js/config.js` | **공개해도 됨.** RLS가 방어한다 |
| secret key (`sb_secret_...`) | 어디에도 두지 않음 | **RLS를 전부 우회한다. 저장소에 넣지 말 것** |
| DB 비밀번호 | 어디에도 두지 않음 | 대시보드 접속용 |

이 저장소는 공개다. 아래 두 줄은 절대 커밋하지 않는다.

## 일시정지 대비

무료 프로젝트는 **1주일간 요청이 없으면 일시정지된다.** 기수 사이에 공백이
생기는 공개과정 특성상 실제로 걸릴 수 있다. 하루 한 번 깨우는 GitHub Actions
스케줄을 별도 작업으로 추가할 것. (아직 안 만들었다.)

## 아직 만들지 않은 것

- `submit_quiz()` — 퀴즈 채점. 수강생에게 `quiz_attempts` insert 권한을 주지
  않은 것이 이 함수를 전제한다. 퀴즈 기능과 함께 작성한다.
- `judge_completion()` — 수료 판정. 출결·수료 기능과 함께 작성한다.
- 프론트엔드 전환 — 아직 Apps Script 백엔드를 쓰고 있다.

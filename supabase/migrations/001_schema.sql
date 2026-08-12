-- IGM LMS 스키마
--
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 실행한다.
-- 001 -> 002 -> 003 순서를 지킬 것. 002를 실행하기 전까지는 RLS가 꺼져 있어
-- 테이블이 공개 상태이므로, 001만 실행한 채로 두지 말 것.
--
-- 설계 근거: docs/superpowers/specs/2026-08-12-supabase-migration-review.md
-- 도메인 규칙: 2026-08-05-lms-design.md, 2026-08-06-class-lesson-design.md

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- profiles : auth.users 를 확장하는 우리 도메인 정보
-- ---------------------------------------------------------------------------
-- 이메일·비밀번호는 auth.users 가 소유한다. 여기 email 은 관리자 목록 조회를
-- 단순하게 하려고 두는 사본이며 트리거로 동기화한다(002).
-- citext + unique 이므로 대소문자만 다른 중복이 DB 수준에서 거부된다.
-- 2026-08-12 로그인 버그가 이 한 줄로 구조적으로 불가능해진다.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        citext      not null unique,
  name         text        not null check (length(trim(name)) > 0),
  phone        text        not null check (length(trim(phone)) > 0),
  company      text        not null check (length(trim(company)) > 0),
  position     text        not null check (length(trim(position)) > 0),
  birth_date   date        not null,
  role         text        not null default 'student'
                 check (role in ('student', 'instructor', 'admin')),
  status       text        not null default 'active'
                 check (status in ('active', 'inactive')),
  consent_at      timestamptz not null,
  retention_until timestamptz not null,
  created_at      timestamptz not null default now()
);

comment on column public.profiles.email is
  'auth.users.email 의 사본. 002의 트리거가 동기화한다. 직접 수정 금지.';
comment on column public.profiles.birth_date is
  '수료증 발급 전용. 본인과 관리자만 볼 수 있다(002의 행 정책).';

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
create table public.classes (
  id                   uuid primary key default gen_random_uuid(),
  class_name           text    not null check (length(trim(class_name)) > 0),
  batch                text    not null check (length(trim(batch)) > 0),
  instructor_id        uuid    references public.profiles(id) on delete set null,
  start_date           date,
  end_date             date,
  watch_rate_threshold numeric(5,2) not null
                         check (watch_rate_threshold between 0 and 100),
  quiz_pass_score      numeric(5,2) not null
                         check (quiz_pass_score between 0 and 100),
  quiz_retry_allowed   boolean not null default false,
  status               text    not null default '모집중'
                         check (status in ('모집중', '진행중', '종료')),
  created_at           timestamptz not null default now(),
  -- 기간 미정으로 클래스를 먼저 열 수 있어야 하므로 둘 중 하나가 비면 통과
  constraint classes_date_range check (
    start_date is null or end_date is null or end_date >= start_date
  )
);

-- watch_rate_threshold 에 불리언이 들어가 0%가 되던 결함은 이제 타입이 막는다.
-- numeric 열에 boolean 을 넣으면 Postgres 가 거부한다.

-- ---------------------------------------------------------------------------
-- lessons
-- ---------------------------------------------------------------------------
create table public.lessons (
  id                 uuid primary key default gen_random_uuid(),
  class_id           uuid    not null references public.classes(id) on delete cascade,
  lesson_order       integer not null check (lesson_order >= 1),
  title              text    not null check (length(trim(title)) > 0),
  -- 사이트가 HTTPS(GitHub Pages)라 http 영상은 브라우저가 혼합 콘텐츠로 막는다.
  video_url          text    not null check (video_url like 'https://%'),
  video_duration_sec integer not null check (video_duration_sec > 0),
  created_at         timestamptz not null default now()
);

-- 주의: (class_id, lesson_order) 에 unique 를 걸지 말 것.
-- 설계 7장이 3번과 5번을 맞바꾸는 중간 상태(같은 번호가 잠시 존재)를 허용한다.
create index lessons_class_order_idx on public.lessons (class_id, lesson_order);

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  status      text not null default '수강중' check (status in ('수강중', '취소')),
  unique (user_id, class_id)
);

-- ---------------------------------------------------------------------------
-- watch_logs
-- ---------------------------------------------------------------------------
-- lesson_id 가 on delete restrict 인 것이 설계 8장의 "시청 기록이 있는 차시는
-- 삭제할 수 없다"를 그대로 구현한다. 핸들러의 확인 로직이 필요 없어진다.
create table public.watch_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  lesson_id       uuid not null references public.lessons(id) on delete restrict,
  max_watched_sec integer not null default 0 check (max_watched_sec >= 0),
  -- watch_rate 는 클라이언트가 보내는 값이 아니라 트리거가 계산한다(002).
  watch_rate      numeric(5,2) not null default 0 check (watch_rate between 0 and 100),
  completed       boolean not null default false,
  last_updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

-- ---------------------------------------------------------------------------
-- 퀴즈
-- ---------------------------------------------------------------------------
create table public.quizzes (
  id         uuid primary key default gen_random_uuid(),
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  quiz_title text not null check (length(trim(quiz_title)) > 0),
  pass_score numeric(5,2) not null check (pass_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid    not null references public.quizzes(id) on delete cascade,
  question_order integer not null check (question_order >= 1),
  question_text  text    not null check (length(trim(question_text)) > 0),
  option1        text    not null,
  option2        text    not null,
  option3        text,
  option4        text,
  score          numeric(5,2) not null check (score > 0)
);

-- 정답을 별도 테이블로 분리한 이유.
-- 수강생은 문제를 읽어야 하므로 quiz_questions 에 읽기 권한이 필요하다.
-- 정답이 같은 행에 있으면 PostgREST 로 그대로 따라 내려간다. Apps Script 시절에는
-- 핸들러가 응답 모양을 정해 막았지만 여기서는 테이블이 곧 API다.
-- 이 테이블에는 수강생 권한을 주지 않는다(002).
create table public.quiz_answer_keys (
  question_id    uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_option smallint not null check (correct_option between 1 and 4)
);

create table public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  score        numeric(5,2) not null check (score >= 0),
  is_passed    boolean not null,
  submitted_at timestamptz not null default now()
);

create table public.quiz_answers (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id     uuid not null references public.quiz_questions(id) on delete cascade,
  selected_option smallint not null check (selected_option between 1 and 4),
  is_correct      boolean not null,
  unique (attempt_id, question_id)
);

-- ---------------------------------------------------------------------------
-- attendance : 수료 판정
-- ---------------------------------------------------------------------------
-- 뷰로 대체하지 않고 테이블로 남기는 이유는 판정 근거의 보존이다.
-- 클래스의 출결 기준이 나중에 바뀌면 이미 발급한 수료증의 근거가 흔들린다.
-- 확정 시점의 기준값을 함께 찍어 둔다.
create table public.attendance (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  class_id                uuid not null references public.classes(id) on delete cascade,
  total_watch_rate        numeric(5,2) not null check (total_watch_rate between 0 and 100),
  total_quiz_score        numeric(5,2) not null check (total_quiz_score >= 0),
  is_completed            boolean not null,
  watch_rate_threshold_at_completion numeric(5,2) not null,
  quiz_pass_score_at_completion      numeric(5,2) not null,
  completed_at            timestamptz,
  unique (user_id, class_id)
);

create table public.certificates (
  id             uuid primary key default gen_random_uuid(),
  attendance_id  uuid not null unique references public.attendance(id) on delete restrict,
  certificate_no text not null unique,
  issued_at      timestamptz not null default now(),
  file_id        text
);

-- ---------------------------------------------------------------------------
-- error_log : 애플리케이션 오류. Supabase 자체 로그와 별개로 도메인 사건을 남긴다.
-- ---------------------------------------------------------------------------
create table public.error_log (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  action      text,
  user_id     uuid,
  message     text,
  stack       text
);

import { signup, login, logout, me, isLoggedIn } from './auth.js';
import {
  myClasses, myLessons, progressOf, saveProgress, shouldSave, progressLabel,
} from './learn.js';
import { formatDuration } from './classes.js';
import { quizOfLesson, myAttempts, submitQuiz, quizCountForLessons } from './quiz.js';
import { myAttendance, completionLabel, myCertificate } from './completion.js';

const views = {
  login: document.getElementById('view-login'),
  signup: document.getElementById('view-signup'),
  home: document.getElementById('view-home'),
  lessons: document.getElementById('view-lessons'),
  player: document.getElementById('view-player'),
  quiz: document.getElementById('view-quiz'),
};

function show(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
}

/** 사용자 입력과 서버 응답은 textContent로만 넣는다. */
function setMessage(id, text) {
  document.getElementById(id).textContent = text || '';
}

function showHome(user) {
  document.getElementById('home-name').textContent = user.name;
  document.getElementById('home-company').textContent = user.company ? ' · ' + user.company : '';
  // 링크를 감추는 것은 편의일 뿐 방어가 아니다. 주소를 직접 쳐서 들어가도
  // 관리자 화면이 역할을 다시 확인하고, 실제 차단은 서버의 RLS 정책이 한다.
  document.getElementById('home-admin').hidden = user.role !== 'admin';
  show('home');
  renderMyClasses();
}

// ---------------------------------------------------------------------------
// 내 과정
// ---------------------------------------------------------------------------

let currentClass = null;
let currentLessons = [];

async function renderMyClasses() {
  const list = document.getElementById('my-class-list');
  list.textContent = '';
  setMessage('message-home', '');

  let rows;
  try {
    rows = await myClasses();
  } catch (err) {
    setMessage('message-home', err.message);
    return;
  }

  document.getElementById('my-class-empty').hidden = rows.length > 0;
  rows.forEach(function (row) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-button';
    button.addEventListener('click', function () { openLessons(row); });

    const head = document.createElement('span');
    head.className = 'row-head';
    const title = document.createElement('strong');
    title.textContent = row.class_name;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = row.status;
    head.append(title, badge);

    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = [row.batch, row.start_date ? row.start_date + ' ~ ' + (row.end_date || '') : '']
      .filter(Boolean).join(' · ');

    button.append(head, detail);
    item.append(button);
    list.append(item);
  });
}

// ---------------------------------------------------------------------------
// 차시 목록
// ---------------------------------------------------------------------------

async function openLessons(row) {
  currentClass = row;
  document.getElementById('lessons-title').textContent = row.class_name;
  document.getElementById('lessons-summary').textContent = '';
  setMessage('message-lessons', '');
  show('lessons');

  const list = document.getElementById('my-lesson-list');
  list.textContent = '';

  try {
    currentLessons = await myLessons(row.id);
  } catch (err) {
    setMessage('message-lessons', err.message);
    return;
  }

  const done = currentLessons.filter(function (lesson) { return progressOf(lesson).completed; }).length;
  document.getElementById('lessons-summary').textContent =
    '전체 ' + currentLessons.length + '차시 중 ' + done + '차시 수강 완료'
    + ' · 수료 기준 ' + Math.round(Number(row.watch_rate_threshold) || 0) + '%';
  document.getElementById('my-lesson-empty').hidden = currentLessons.length > 0;

  // 수료 여부는 관리자가 판정을 실행해야 정해진다. 판정 전이라도 화면이
  // 비어 보이지 않게 그렇다고 적어 준다.
  try {
    const record = await myAttendance(row.id);
    const hasQuiz = (await quizCountForLessons(
      currentLessons.map(function (lesson) { return lesson.id; }))) > 0;
    const cert = record && record.is_completed ? await myCertificate(row.id) : null;
    document.getElementById('lessons-completion').textContent =
      '수료 판정 · ' + completionLabel(record, { hasQuiz: hasQuiz })
      + (cert ? ' · 수료증 ' + cert.certificate_no : '');
  } catch (err) {
    document.getElementById('lessons-completion').textContent = '';
  }

  currentLessons.forEach(function (lesson) {
    const progress = progressOf(lesson);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-button';
    button.addEventListener('click', function () { openPlayer(lesson); });

    const head = document.createElement('span');
    head.className = 'row-head';
    const order = document.createElement('span');
    order.className = 'badge';
    order.textContent = lesson.lesson_order + '차시';
    const title = document.createElement('strong');
    title.textContent = lesson.title;
    head.append(order, title);

    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = formatDuration(lesson.video_duration_sec)
      + ' · ' + progressLabel(progress, row.watch_rate_threshold);

    button.append(head, detail);
    item.append(button);
    list.append(item);
  });
}

// ---------------------------------------------------------------------------
// 재생
// ---------------------------------------------------------------------------

const player = document.getElementById('player');
let currentLesson = null;
let lastSavedSec = 0;

function setPlayerProgress(progress) {
  document.getElementById('player-progress').textContent =
    currentLesson
      ? formatDuration(currentLesson.video_duration_sec) + ' · '
        + progressLabel(progress, currentClass && currentClass.watch_rate_threshold)
      : '';
}

async function openPlayer(lesson) {
  currentLesson = lesson;
  const progress = progressOf(lesson);
  lastSavedSec = progress.max_watched_sec;

  document.getElementById('player-title').textContent = lesson.lesson_order + '차시 · ' + lesson.title;
  setMessage('message-player', '');
  setPlayerProgress(progress);
  document.getElementById('player-quiz').hidden = true;
  show('player');

  // 퀴즈가 있는 차시에만 버튼을 보인다. 조회가 실패해도 재생은 막지 않는다.
  quizOfLesson(lesson.id).then(function (quiz) {
    lessonQuiz = quiz;
    document.getElementById('player-quiz').hidden = !quiz;
  }).catch(function () {
    lessonQuiz = null;
  });

  player.src = lesson.video_url;
  // 이어보기. 끝까지 본 영상은 처음부터 다시 틀어 준다.
  player.currentTime = progress.max_watched_sec < Number(lesson.video_duration_sec)
    ? progress.max_watched_sec
    : 0;
}

/** 저장 실패가 재생을 멈춰서는 안 된다. 알리기만 하고 계속 본다. */
async function pushProgress(seconds) {
  if (!currentLesson) return;
  lastSavedSec = Math.floor(seconds);
  try {
    const saved = await saveProgress(currentLesson.id, seconds);
    setMessage('message-player', '');
    setPlayerProgress(saved);
    // 목록으로 돌아갔을 때 방금 진도가 반영되어 있어야 한다.
    currentLesson.watch_logs = [saved];
  } catch (err) {
    setMessage('message-player', '시청 기록을 저장하지 못했습니다. 연결을 확인해 주세요.');
  }
}

player.addEventListener('timeupdate', function () {
  if (shouldSave(lastSavedSec, player.currentTime)) pushProgress(player.currentTime);
});

player.addEventListener('pause', function () {
  if (player.currentTime > lastSavedSec) pushProgress(player.currentTime);
});

player.addEventListener('ended', function () {
  pushProgress(player.currentTime);
});

player.addEventListener('error', function () {
  setMessage('message-player', '영상을 불러오지 못했습니다. 담당자에게 알려 주세요.');
});

/** 탭을 닫거나 숨길 때 마지막 위치를 남긴다. 여기서 잃으면 다시 봐야 한다. */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && currentLesson && player.currentTime > lastSavedSec) {
    pushProgress(player.currentTime);
  }
});

function stopPlayback() {
  player.pause();
  player.removeAttribute('src');
  player.load();
  currentLesson = null;
  lessonQuiz = null;
  document.getElementById('player-quiz').hidden = true;
}

document.getElementById('back-to-home').addEventListener('click', function () {
  show('home');
  renderMyClasses();
});

document.getElementById('back-to-lessons').addEventListener('click', async function () {
  stopPlayback();
  if (currentClass) await openLessons(currentClass);
});

// ---------------------------------------------------------------------------
// 퀴즈 응시
// ---------------------------------------------------------------------------

let lessonQuiz = null;

function attemptSummary(attempts) {
  if (!attempts.length) return '아직 응시하지 않았습니다.';
  const best = attempts.reduce(function (top, row) {
    return Number(row.score) > Number(top.score) ? row : top;
  });
  return '응시 ' + attempts.length + '회 · 최고 ' + Math.round(Number(best.score)) + '점'
    + (attempts.some(function (row) { return row.is_passed; }) ? ' · 합격' : '');
}

async function openQuiz() {
  if (!lessonQuiz) return;
  // 영상을 틀어둔 채로 문제를 풀면 진도가 계속 올라간다. 멈추되 차시는 기억해 둔다.
  player.pause();

  document.getElementById('quiz-title').textContent = lessonQuiz.quiz_title;
  document.getElementById('quiz-info').textContent =
    (lessonQuiz.quiz_questions || []).length + '문항 · 합격 '
    + Math.round(Number(lessonQuiz.pass_score) || 0) + '점';
  document.getElementById('quiz-result').textContent = '';
  setMessage('message-quiz-take', '');
  document.getElementById('submit-quiz').disabled = false;
  show('quiz');

  try {
    document.getElementById('quiz-history').textContent = attemptSummary(await myAttempts(lessonQuiz.id));
  } catch (err) {
    document.getElementById('quiz-history').textContent = '';
  }

  const wrap = document.getElementById('question-fields');
  wrap.textContent = '';
  (lessonQuiz.quiz_questions || []).forEach(function (question) {
    const item = document.createElement('li');
    const text = document.createElement('p');
    text.textContent = question.question_text + ' (' + question.score + '점)';
    item.append(text);

    [1, 2, 3, 4].forEach(function (number) {
      const option = question['option' + number];
      if (!option) return;   // 비어 있는 보기는 그리지 않는다
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'q_' + question.id;
      input.value = String(number);
      const span = document.createElement('span');
      span.textContent = option;
      label.append(input, span);
      item.append(label);
    });

    wrap.append(item);
  });
}

document.getElementById('go-quiz').addEventListener('click', openQuiz);

document.getElementById('back-to-player').addEventListener('click', function () {
  show('player');
});

document.getElementById('form-quiz-take').addEventListener('submit', async function (event) {
  event.preventDefault();
  setMessage('message-quiz-take', '');

  const answers = [];
  (lessonQuiz.quiz_questions || []).forEach(function (question) {
    const picked = document.querySelector('input[name="q_' + question.id + '"]:checked');
    if (picked) answers.push({ question_id: question.id, selected_option: Number(picked.value) });
  });

  if (!answers.length) {
    // 하나도 고르지 않은 제출은 응시 횟수만 쓴다. 재응시가 막힌 클래스라면
    // 그 한 번으로 끝난다. 확인을 묻지 않고 바로 막는다.
    setMessage('message-quiz-take', '답을 하나 이상 선택해 주세요.');
    return;
  }
  const unanswered = (lessonQuiz.quiz_questions || []).length - answers.length;
  if (unanswered > 0 && !window.confirm(unanswered + '문항이 비어 있습니다. 그대로 제출할까요?')) return;

  const button = document.getElementById('submit-quiz');
  button.disabled = true;
  try {
    const result = await submitQuiz(lessonQuiz.id, answers);
    document.getElementById('quiz-result').textContent =
      Math.round(Number(result.score)) + '점 · ' + result.correct_count + '/' + result.question_count
      + '문항 정답 · ' + (result.is_passed ? '합격' : '불합격');
    document.getElementById('quiz-history').textContent = attemptSummary(await myAttempts(lessonQuiz.id));
  } catch (err) {
    setMessage('message-quiz-take', err.message);
    button.disabled = false;
  }
});

function formValues(form) {
  const data = {};
  new FormData(form).forEach(function (value, key) { data[key] = value; });
  return data;
}

function busy(form, on) {
  form.querySelector('button[type="submit"]').disabled = on;
}

document.getElementById('go-signup').addEventListener('click', function () {
  setMessage('message-signup', '');
  show('signup');
});

document.getElementById('go-login').addEventListener('click', function () {
  setMessage('message-login', '');
  show('login');
});

document.getElementById('form-login').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-login', '');
  busy(form, true);
  try {
    const values = formValues(form);
    showHome(await login(values.email, values.password));
    form.reset();
  } catch (err) {
    setMessage('message-login', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('form-signup').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-signup', '');

  const values = formValues(form);
  values.consent = form.querySelector('input[name="consent"]').checked;
  if (!values.consent) {
    setMessage('message-signup', '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
    return;
  }

  busy(form, true);
  try {
    showHome(await signup(values));
    form.reset();
  } catch (err) {
    setMessage('message-signup', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('do-logout').addEventListener('click', async function () {
  // 로그아웃하면서 재생을 멈추고 남은 상태를 비운다. 다음 사람이 같은 기기로
  // 로그인했을 때 앞사람의 과정이 잠깐 보이면 안 된다.
  stopPlayback();
  currentClass = null;
  currentLessons = [];
  document.getElementById('my-class-list').textContent = '';
  await logout();
  show('login');
});

// 새로고침해도 로그인이 유지되게 한다. 토큰이 죽었으면 auth.js가 지우고
// 여기서는 로그인 화면으로 돌아간다.
(async function start() {
  if (!isLoggedIn()) {
    show('login');
    return;
  }
  try {
    showHome(await me());
  } catch (err) {
    show('login');
  }
})();

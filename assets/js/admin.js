import { me, isLoggedIn } from './auth.js';
import {
  listClasses, getClass, saveClass, listInstructors,
  listLessons, saveLesson, deleteLesson, nextLessonOrder,
  measureVideoDuration, formatDuration,
} from './classes.js';
import {
  listRoster, searchStudents, enroll, cancelEnrollment,
} from './enrollments.js';
import {
  quizOfLesson, saveQuiz, listQuestionsWithKeys, correctOptionOf,
  nextQuestionOrder, saveQuestion, deleteQuestion,
} from './quiz.js';
import { judgeClass, classAttendance, completionLabel } from './completion.js';
import { quizCountForLessons } from './quiz.js';

const views = {
  loading: document.getElementById('view-loading'),
  denied: document.getElementById('view-denied'),
  admin: document.getElementById('view-admin'),
  class: document.getElementById('view-class'),
  quiz: document.getElementById('view-quiz'),
};

let currentClassId = null;
let currentLessons = [];
let editingLessonId = null;
let instructors = [];

function show(name) {
  Object.keys(views).forEach(function (key) {
    views[key].hidden = key !== name;
  });
}

/** 서버 응답과 사용자 입력은 textContent 로만 넣는다. */
function setMessage(id, text) {
  document.getElementById(id).textContent = text || '';
}

function busy(form, on) {
  form.querySelectorAll('button').forEach(function (button) { button.disabled = on; });
}

function formValues(form) {
  const data = {};
  new FormData(form).forEach(function (value, key) { data[key] = value; });
  return data;
}

/** 비어 있으면 보내지 않는다. 담기지 않은 항목은 기존 값이 그대로 남는다. */
function optional(fields, key, value) {
  if (value === undefined || value === null || String(value).trim() === '') return;
  fields[key] = value;
}

// ---------------------------------------------------------------------------
// 클래스 목록
// ---------------------------------------------------------------------------

function classLine(row) {
  const parts = [row.batch];
  if (row.start_date) parts.push(row.start_date + ' ~ ' + (row.end_date || ''));
  parts.push('시청 ' + row.watch_rate_threshold + '% · 퀴즈 ' + row.quiz_pass_score + '점');
  return parts.join(' · ');
}

async function renderClassList() {
  setMessage('message-list', '');
  const list = document.getElementById('class-list');
  list.textContent = '';

  let rows;
  try {
    rows = await listClasses();
  } catch (err) {
    setMessage('message-list', err.message);
    return;
  }

  document.getElementById('class-empty').hidden = rows.length > 0;
  rows.forEach(function (row) {
    const item = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-button';
    button.addEventListener('click', function () { openClass(row.id); });

    const title = document.createElement('strong');
    title.textContent = row.class_name;
    const status = document.createElement('span');
    status.className = 'badge';
    status.textContent = row.status;
    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = classLine(row);

    const head = document.createElement('span');
    head.className = 'row-head';
    head.append(title, status);
    button.append(head, detail);
    item.append(button);
    list.append(item);
  });
}

// ---------------------------------------------------------------------------
// 클래스 편집
// ---------------------------------------------------------------------------

function fillInstructorOptions(selectedId) {
  const select = document.getElementById('instructor-select');
  select.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '미정';
  select.append(none);
  instructors.forEach(function (person) {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.company ? person.name + ' (' + person.company + ')' : person.name;
    select.append(option);
  });
  select.value = selectedId || '';
}

function fillClassForm(row) {
  const form = document.getElementById('form-class');
  form.reset();
  fillInstructorOptions(row && row.instructor_id);
  if (!row) return;
  form.class_name.value = row.class_name || '';
  form.batch.value = row.batch || '';
  form.start_date.value = row.start_date || '';
  form.end_date.value = row.end_date || '';
  form.watch_rate_threshold.value = row.watch_rate_threshold;
  form.quiz_pass_score.value = row.quiz_pass_score;
  form.status.value = row.status || '모집중';
  form.quiz_retry_allowed.checked = !!row.quiz_retry_allowed;
}

async function openClass(id) {
  currentClassId = id;
  editingLessonId = null;
  setMessage('message-class', '');
  setMessage('message-lesson-list', '');
  setMessage('message-roster', '');
  document.getElementById('form-lesson').hidden = true;
  document.getElementById('enroll-panel').hidden = true;
  document.getElementById('student-search').value = '';
  show('class');

  if (!id) {
    // 저장하기 전에는 차시도 수강생도 붙일 곳이 없다.
    document.getElementById('class-title').textContent = '새 클래스';
    document.getElementById('lesson-area').hidden = true;
    document.getElementById('enroll-area').hidden = true;
    fillClassForm(null);
    return;
  }

  document.getElementById('lesson-area').hidden = false;
  document.getElementById('enroll-area').hidden = false;
  try {
    const row = await getClass(id);
    if (!row) {
      setMessage('message-class', '클래스를 찾을 수 없습니다.');
      return;
    }
    document.getElementById('class-title').textContent = row.class_name;
    fillClassForm(row);
    await renderLessons();
    await renderRoster();
  } catch (err) {
    setMessage('message-class', err.message);
  }
}

document.getElementById('form-class').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-class', '');

  const values = formValues(form);
  const fields = {
    class_name: String(values.class_name || '').trim(),
    batch: String(values.batch || '').trim(),
    watch_rate_threshold: Number(values.watch_rate_threshold),
    quiz_pass_score: Number(values.quiz_pass_score),
    status: values.status,
    quiz_retry_allowed: form.quiz_retry_allowed.checked,
    // 담당 강사와 기간은 비울 수 있는 항목이라 null 로 명시해 보낸다.
    // 보내지 않으면 기존 값이 남아 "미정으로 되돌리기"가 불가능해진다.
    instructor_id: values.instructor_id ? values.instructor_id : null,
    start_date: values.start_date ? values.start_date : null,
    end_date: values.end_date ? values.end_date : null,
  };

  busy(form, true);
  try {
    const saved = await saveClass(fields, currentClassId);
    currentClassId = saved.id;
    document.getElementById('class-title').textContent = saved.class_name;
    document.getElementById('lesson-area').hidden = false;
    document.getElementById('enroll-area').hidden = false;
    setMessage('message-class', '저장했습니다.');
    await renderLessons();
    await renderRoster();
  } catch (err) {
    setMessage('message-class', err.message);
  } finally {
    busy(form, false);
  }
});

// ---------------------------------------------------------------------------
// 차시
// ---------------------------------------------------------------------------

async function renderLessons() {
  const list = document.getElementById('lesson-list');
  list.textContent = '';
  setMessage('message-lesson-list', '');

  try {
    currentLessons = await listLessons(currentClassId);
  } catch (err) {
    setMessage('message-lesson-list', err.message);
    return;
  }

  document.getElementById('lesson-empty').hidden = currentLessons.length > 0;
  currentLessons.forEach(function (lesson) {
    const item = document.createElement('li');
    item.className = 'row-flex';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'row-button';
    open.addEventListener('click', function () { openLessonForm(lesson); });

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
    detail.textContent = formatDuration(lesson.video_duration_sec);
    open.append(head, detail);

    const quizButton = document.createElement('button');
    quizButton.type = 'button';
    quizButton.className = 'secondary';
    quizButton.textContent = '퀴즈';
    quizButton.addEventListener('click', function () { openQuiz(lesson); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '삭제';
    remove.addEventListener('click', function () { removeLesson(lesson); });

    item.append(open, quizButton, remove);
    list.append(item);
  });
}

function openLessonForm(lesson) {
  const form = document.getElementById('form-lesson');
  form.hidden = false;
  form.reset();
  setMessage('message-lesson', '');
  document.getElementById('duration-hint').textContent = '';
  editingLessonId = lesson ? lesson.id : null;
  document.getElementById('lesson-form-title').textContent = lesson ? '차시 수정' : '차시 추가';

  if (lesson) {
    form.lesson_order.value = lesson.lesson_order;
    form.title.value = lesson.title;
    form.video_url.value = lesson.video_url;
    form.video_duration_sec.value = lesson.video_duration_sec;
  } else {
    form.lesson_order.value = nextLessonOrder(currentLessons);
  }
  form.title.focus();
}

/**
 * 주소를 넣고 칸을 벗어나면 길이를 잰다.
 * 실패해도 막지 않는다. 직접 입력하는 길이 보정 경로를 남겨야 하기 때문이다.
 */
document.getElementById('form-lesson').video_url.addEventListener('change', async function (event) {
  const url = String(event.target.value || '').trim();
  const hint = document.getElementById('duration-hint');
  const durationInput = document.getElementById('form-lesson').video_duration_sec;
  if (!/^https:\/\/\S+$/.test(url)) return;

  hint.textContent = '길이를 재는 중입니다.';
  try {
    const seconds = await measureVideoDuration(url);
    durationInput.value = seconds;
    hint.textContent = '자동 측정: ' + formatDuration(seconds);
  } catch (err) {
    hint.textContent = err.message;
  }
});

document.getElementById('form-lesson').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-lesson', '');

  const values = formValues(form);
  const fields = {
    class_id: currentClassId,
    lesson_order: Number(values.lesson_order),
    title: String(values.title || '').trim(),
    video_url: String(values.video_url || '').trim(),
    video_duration_sec: Number(values.video_duration_sec),
  };

  busy(form, true);
  try {
    await saveLesson(fields, editingLessonId);
    form.hidden = true;
    await renderLessons();
  } catch (err) {
    setMessage('message-lesson', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('cancel-lesson').addEventListener('click', function () {
  document.getElementById('form-lesson').hidden = true;
});

async function removeLesson(lesson) {
  if (!window.confirm(lesson.lesson_order + '차시 「' + lesson.title + '」을 삭제할까요?')) return;
  setMessage('message-lesson-list', '');
  try {
    await deleteLesson(lesson.id);
    await renderLessons();
  } catch (err) {
    setMessage('message-lesson-list', err.message);
  }
}

// ---------------------------------------------------------------------------
// 수강생
// ---------------------------------------------------------------------------

let rosterIds = [];

async function renderRoster() {
  const list = document.getElementById('roster-list');
  list.textContent = '';
  setMessage('message-roster', '');

  let rows;
  try {
    rows = await listRoster(currentClassId);
  } catch (err) {
    setMessage('message-roster', err.message);
    return;
  }

  rosterIds = rows.map(function (row) { return row.user_id; });
  document.getElementById('roster-empty').hidden = rows.length > 0;

  // 이미 내려진 판정만 읽는다. 목록을 여는 것만으로 다시 판정하면
  // 수료 시각이 흔들린다.
  let judged = {};
  let hasQuiz = true;
  try {
    (await classAttendance(currentClassId)).forEach(function (row) { judged[row.user_id] = row; });
    hasQuiz = (await quizCountForLessons(currentLessons.map(function (l) { return l.id; }))) > 0;
  } catch (err) {
    setMessage('message-roster', err.message);
  }

  rows.forEach(function (person) {
    const item = document.createElement('li');

    const info = document.createElement('span');
    info.className = 'row-button row-static';
    const head = document.createElement('span');
    head.className = 'row-head';
    const name = document.createElement('strong');
    name.textContent = person.name;
    const mark = document.createElement('span');
    mark.className = 'badge';
    mark.textContent = judged[person.user_id]
      ? (judged[person.user_id].is_completed ? '수료' : '미수료')
      : '미판정';
    head.append(name, mark);
    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = [person.email, person.company, person.position]
      .filter(Boolean).join(' · ')
      + ' / ' + completionLabel(judged[person.user_id], { hasQuiz: hasQuiz });
    info.append(head, detail);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '취소';
    remove.addEventListener('click', function () { removeEnrollment(person); });

    item.append(info, remove);
    list.append(item);
  });
}

async function removeEnrollment(person) {
  if (!window.confirm(person.name + ' 님의 수강을 취소할까요? 시청 기록은 남습니다.')) return;
  setMessage('message-roster', '');
  try {
    await cancelEnrollment(person.user_id, currentClassId);
    await renderRoster();
    await renderStudentResults();
  } catch (err) {
    setMessage('message-roster', err.message);
  }
}

async function renderStudentResults() {
  const panel = document.getElementById('enroll-panel');
  if (panel.hidden) return;

  const list = document.getElementById('student-list');
  list.textContent = '';
  setMessage('message-enroll', '');

  let rows;
  try {
    rows = await searchStudents(document.getElementById('student-search').value);
  } catch (err) {
    setMessage('message-enroll', err.message);
    return;
  }

  // 이미 등록된 사람은 빼고 보여준다. 눌러도 "이미 등록됨"만 나오는 줄을
  // 남겨두면 목록만 길어진다.
  const candidates = rows.filter(function (row) { return rosterIds.indexOf(row.id) === -1; });
  document.getElementById('student-empty').hidden = candidates.length > 0;

  candidates.forEach(function (person) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-button';
    button.addEventListener('click', function () { addEnrollment(person, button); });

    const head = document.createElement('span');
    head.className = 'row-head';
    const name = document.createElement('strong');
    name.textContent = person.name;
    head.append(name);
    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = [person.email, person.company].filter(Boolean).join(' · ');

    button.append(head, detail);
    item.append(button);
    list.append(item);
  });
}

async function addEnrollment(person, button) {
  setMessage('message-enroll', '');
  button.disabled = true;
  try {
    await enroll(person.id, currentClassId);
    await renderRoster();
    await renderStudentResults();
  } catch (err) {
    setMessage('message-enroll', err.message);
    button.disabled = false;
  }
}

document.getElementById('judge-class').addEventListener('click', async function () {
  const button = document.getElementById('judge-class');
  setMessage('message-roster', '');
  button.disabled = true;
  try {
    const rows = await judgeClass(currentClassId);
    const done = rows.filter(function (row) { return row.is_completed; }).length;
    document.getElementById('judge-note').textContent =
      rows.length + '명 판정 · ' + done + '명 수료';
    await renderRoster();
  } catch (err) {
    setMessage('message-roster', err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('toggle-enroll').addEventListener('click', async function () {
  const panel = document.getElementById('enroll-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    document.getElementById('student-search').focus();
    await renderStudentResults();
  }
});

// 입력이 멈춘 뒤에 찾는다. 글자마다 보내면 요청이 줄줄이 나간다.
let searchTimer = null;
document.getElementById('student-search').addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderStudentResults, 300);
});

// ---------------------------------------------------------------------------
// 퀴즈 출제
// ---------------------------------------------------------------------------

let quizLesson = null;
let currentQuiz = null;
let currentQuestions = [];
let editingQuestionId = null;

async function openQuiz(lesson) {
  quizLesson = lesson;
  currentQuiz = null;
  currentQuestions = [];
  editingQuestionId = null;

  document.getElementById('quiz-lesson-title').textContent =
    lesson.lesson_order + '차시 · ' + lesson.title;
  setMessage('message-quiz', '');
  setMessage('message-question-list', '');
  document.getElementById('form-question').hidden = true;
  document.getElementById('question-area').hidden = true;
  document.getElementById('form-quiz').reset();
  show('quiz');

  try {
    currentQuiz = await quizOfLesson(lesson.id);
  } catch (err) {
    setMessage('message-quiz', err.message);
    return;
  }

  if (!currentQuiz) {
    // 아직 퀴즈가 없는 차시다. 제목과 합격 점수를 저장하면 문항을 붙일 수 있다.
    document.getElementById('form-quiz').pass_score.value = 60;
    return;
  }

  const form = document.getElementById('form-quiz');
  form.quiz_title.value = currentQuiz.quiz_title;
  form.pass_score.value = currentQuiz.pass_score;
  document.getElementById('question-area').hidden = false;
  await renderQuestions();
}

document.getElementById('form-quiz').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-quiz', '');
  const values = formValues(form);

  busy(form, true);
  try {
    currentQuiz = await saveQuiz(quizLesson.id, {
      quiz_title: values.quiz_title,
      pass_score: Number(values.pass_score),
    }, currentQuiz && currentQuiz.id);
    document.getElementById('question-area').hidden = false;
    setMessage('message-quiz', '저장했습니다.');
    await renderQuestions();
  } catch (err) {
    setMessage('message-quiz', err.message);
  } finally {
    busy(form, false);
  }
});

async function renderQuestions() {
  const list = document.getElementById('question-list');
  list.textContent = '';
  setMessage('message-question-list', '');

  try {
    currentQuestions = await listQuestionsWithKeys(currentQuiz.id);
  } catch (err) {
    setMessage('message-question-list', err.message);
    return;
  }

  const total = currentQuestions.reduce(function (sum, q) { return sum + (Number(q.score) || 0); }, 0);
  // 배점 합이 100이 아니어도 된다. 점수는 백분율로 환산되므로 그렇다고 알려만 준다.
  document.getElementById('question-total').textContent =
    currentQuestions.length + '문항 · 배점 합계 ' + total + '점 (점수는 100점 만점으로 환산됩니다)';
  document.getElementById('question-empty').hidden = currentQuestions.length > 0;

  currentQuestions.forEach(function (question) {
    const correct = correctOptionOf(question);
    const item = document.createElement('li');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'row-button';
    open.addEventListener('click', function () { openQuestionForm(question); });

    const head = document.createElement('span');
    head.className = 'row-head';
    const order = document.createElement('span');
    order.className = 'badge';
    order.textContent = question.question_order + '번';
    const text = document.createElement('strong');
    text.textContent = question.question_text;
    head.append(order, text);

    const detail = document.createElement('span');
    detail.className = 'row-detail';
    detail.textContent = '배점 ' + question.score + '점 · 정답 '
      + (correct ? correct + '번' : '미지정');
    open.append(head, detail);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '삭제';
    remove.addEventListener('click', function () { removeQuestion(question); });

    item.append(open, remove);
    list.append(item);
  });
}

function openQuestionForm(question) {
  const form = document.getElementById('form-question');
  form.hidden = false;
  form.reset();
  setMessage('message-question', '');
  editingQuestionId = question ? question.id : null;
  document.getElementById('question-form-title').textContent = question ? '문항 수정' : '문항 추가';

  if (question) {
    form.question_order.value = question.question_order;
    form.score.value = question.score;
    form.question_text.value = question.question_text;
    form.option1.value = question.option1 || '';
    form.option2.value = question.option2 || '';
    form.option3.value = question.option3 || '';
    form.option4.value = question.option4 || '';
    form.correct_option.value = String(correctOptionOf(question) || 1);
  } else {
    form.question_order.value = nextQuestionOrder(currentQuestions);
    form.score.value = 10;
  }
  form.question_text.focus();
}

document.getElementById('form-question').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.target;
  setMessage('message-question', '');
  const values = formValues(form);

  busy(form, true);
  try {
    await saveQuestion(currentQuiz.id, {
      question_order: Number(values.question_order),
      score: Number(values.score),
      question_text: values.question_text,
      option1: values.option1,
      option2: values.option2,
      option3: values.option3,
      option4: values.option4,
      correct_option: Number(values.correct_option),
    }, editingQuestionId);
    form.hidden = true;
    await renderQuestions();
  } catch (err) {
    setMessage('message-question', err.message);
  } finally {
    busy(form, false);
  }
});

document.getElementById('cancel-question').addEventListener('click', function () {
  document.getElementById('form-question').hidden = true;
});

async function removeQuestion(question) {
  if (!window.confirm(question.question_order + '번 문항을 삭제할까요?')) return;
  setMessage('message-question-list', '');
  try {
    await deleteQuestion(question.id);
    await renderQuestions();
  } catch (err) {
    setMessage('message-question-list', err.message);
  }
}

document.getElementById('new-question').addEventListener('click', function () { openQuestionForm(null); });
document.getElementById('back-to-class').addEventListener('click', async function () {
  await openClass(currentClassId);
});

// ---------------------------------------------------------------------------
// 진입
// ---------------------------------------------------------------------------

document.getElementById('new-class').addEventListener('click', function () { openClass(null); });
document.getElementById('new-lesson').addEventListener('click', function () { openLessonForm(null); });
document.getElementById('back-to-list').addEventListener('click', async function () {
  show('admin');
  await renderClassList();
});

function deny(reason) {
  document.getElementById('denied-reason').textContent = reason;
  show('denied');
}

(async function start() {
  if (!isLoggedIn()) {
    deny('로그인이 필요합니다.');
    return;
  }
  let user;
  try {
    user = await me();
  } catch (err) {
    deny(err.message);
    return;
  }
  // 화면을 감추는 것은 편의일 뿐 방어가 아니다. 실제 차단은 RLS 정책이 한다.
  // 여기를 뚫어도 서버가 거부한다.
  if (user.role !== 'admin') {
    deny('관리자만 사용할 수 있는 화면입니다.');
    return;
  }

  try {
    instructors = await listInstructors();
  } catch (err) {
    instructors = [];   // 후보를 못 불러와도 클래스 관리 자체는 되어야 한다
  }

  show('admin');
  await renderClassList();
})();

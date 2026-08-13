'use strict';

const test = require('node:test');
const assert = require('node:assert');
const shim = require('./helpers/browser-shim');

const URL = 'https://project.test';
const KEY = 'sb_publishable_test';

shim.installLocalStorage();

let api;
let quiz;

async function load() {
  api = await import('../assets/js/api.js');
  quiz = await import('../assets/js/quiz.js');
  api.setEndpoint(URL, KEY);
  api.setRetryDelays([1, 1]);
  shim.resetLocalStorage();
  api.saveSession({
    access_token: 'ACCESS1', refresh_token: 'REFRESH1',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user_id: 'U-1',
  });
}

const json = (value) => ({ text: JSON.stringify(value) });

function server(routes) {
  shim.installFetch(async (url, options) => {
    const path = String(url);
    const method = (options && options.method) || 'GET';
    for (const route of routes) {
      if (path.indexOf(route.match) !== -1 && (!route.method || route.method === method)) {
        if (route.throws) throw new Error('network down');
        return route.reply;
      }
    }
    return json([]);
  });
}

function questionFields(overrides) {
  return Object.assign({
    question_order: 1, question_text: '무엇이 맞는가', option1: 'ㄱ', option2: 'ㄴ',
    option3: 'ㄷ', option4: '', score: 10, correct_option: 3,
  }, overrides || {});
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

test('퀴즈 제목과 합격 점수를 검사한다', async () => {
  await load();
  assert.match(quiz.validateQuiz({ quiz_title: ' ', pass_score: 60 }), /제목/);
  assert.match(quiz.validateQuiz({ quiz_title: 'x', pass_score: 120 }), /0~100/);
  assert.match(quiz.validateQuiz({ quiz_title: 'x', pass_score: false }), /0~100/);
  assert.strictEqual(quiz.validateQuiz({ quiz_title: 'x', pass_score: 60 }), null);
});

test('정답이 비어 있는 보기를 가리키면 거부한다', async () => {
  await load();
  // 아무도 맞힐 수 없는 문제가 된다. 오류 없이 전원 오답으로만 나타난다.
  assert.match(quiz.validateQuestion(questionFields({ correct_option: 4 })), /비어 있습니다/);
  assert.strictEqual(quiz.validateQuestion(questionFields({ correct_option: 3 })), null);
});

test('문항의 나머지 조건도 검사한다', async () => {
  await load();
  assert.match(quiz.validateQuestion(questionFields({ question_text: '' })), /문제/);
  assert.match(quiz.validateQuestion(questionFields({ option2: '' })), /최소 두 개/);
  assert.match(quiz.validateQuestion(questionFields({ score: 0 })), /배점/);
  assert.match(quiz.validateQuestion(questionFields({ correct_option: 5 })), /1~4/);
  assert.match(quiz.validateQuestion(questionFields({ correct_option: 1.5 })), /1~4/);
});

test('검증에 걸리면 요청을 보내지 않는다', async () => {
  await load();
  server([{ match: '/quiz', reply: json([{ id: 'Q-1' }]) }]);
  try {
    await assert.rejects(() => quiz.saveQuiz('L-1', { quiz_title: '', pass_score: 60 }), /제목/);
    await assert.rejects(() => quiz.saveQuestion('Z-1', questionFields({ correct_option: 4 })), /비어 있습니다/);
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 수강생
// ---------------------------------------------------------------------------

test('수강생이 읽는 문제에는 정답 열을 요청하지 않는다', async () => {
  await load();
  server([{ match: '/quizzes', reply: json([{ id: 'Z-1', quiz_title: '1차시 퀴즈', pass_score: 60, quiz_questions: [] }]) }]);

  try {
    await quiz.quizOfLesson('L-1');
    const url = decodeURIComponent(String(shim.lastRequest().url));
    assert.strictEqual(url.indexOf('correct_option'), -1);
    assert.strictEqual(url.indexOf('quiz_answer_keys'), -1);
    assert.match(url, /quiz_questions\.order=question_order\.asc/);
  } finally {
    shim.restoreFetch();
  }
});

test('퀴즈가 없는 차시면 null을 돌려준다', async () => {
  await load();
  server([{ match: '/quizzes', reply: json([]) }]);
  try {
    assert.strictEqual(await quiz.quizOfLesson('L-1'), null);
  } finally {
    shim.restoreFetch();
  }
});

test('제출은 서버 함수로 보내고 결과를 그대로 받는다', async () => {
  await load();
  server([{ match: '/rpc/submit_quiz', reply: json([{ attempt_id: 'A-1', score: 80, is_passed: true, correct_count: 4, question_count: 5 }]) }]);

  try {
    const answers = [{ question_id: 'Q-1', selected_option: 3 }];
    const result = await quiz.submitQuiz('Z-1', answers);
    assert.strictEqual(result.score, 80);
    assert.strictEqual(result.is_passed, true);

    const sent = shim.lastRequest();
    assert.match(String(sent.url), /\/rpc\/submit_quiz$/);
    assert.deepStrictEqual(JSON.parse(sent.options.body), { p_quiz_id: 'Z-1', p_answers: answers });
  } finally {
    shim.restoreFetch();
  }
});

test('빈 답안은 보내지 않는다', async () => {
  await load();
  server([{ match: '/rpc/submit_quiz', reply: json([]) }]);
  try {
    await assert.rejects(() => quiz.submitQuiz('Z-1', []), /하나 이상/);
    assert.strictEqual(shim.requests().length, 0);
  } finally {
    shim.restoreFetch();
  }
});

// ---------------------------------------------------------------------------
// 관리자: 문제와 정답
// ---------------------------------------------------------------------------

test('문제를 저장하면 정답도 함께 저장한다', async () => {
  await load();
  server([
    { match: '/quiz_questions', method: 'POST', reply: json([{ id: 'Q-9' }]) },
    { match: '/quiz_answer_keys', method: 'POST', reply: json([{ question_id: 'Q-9' }]) },
  ]);

  try {
    const saved = await quiz.saveQuestion('Z-1', questionFields());
    assert.strictEqual(saved.id, 'Q-9');

    const [question, key] = shim.requests();
    assert.strictEqual(JSON.parse(question.options.body).quiz_id, 'Z-1');
    assert.match(String(key.url), /on_conflict=question_id/);
    assert.deepStrictEqual(JSON.parse(key.options.body), { question_id: 'Q-9', correct_option: 3 });
  } finally {
    shim.restoreFetch();
  }
});

test('빈 보기는 null로 저장한다', async () => {
  await load();
  server([
    { match: '/quiz_questions', method: 'POST', reply: json([{ id: 'Q-9' }]) },
    { match: '/quiz_answer_keys', method: 'POST', reply: json([{ question_id: 'Q-9' }]) },
  ]);

  try {
    await quiz.saveQuestion('Z-1', questionFields());
    const body = JSON.parse(shim.requests()[0].options.body);
    assert.strictEqual(body.option3, 'ㄷ');
    assert.strictEqual(body.option4, null);
  } finally {
    shim.restoreFetch();
  }
});

test('새 문제인데 정답 저장이 실패하면 문제도 남기지 않는다', async () => {
  await load();
  const deleted = [];
  shim.installFetch(async (url, options) => {
    const path = String(url);
    const method = (options && options.method) || 'GET';
    if (path.indexOf('/quiz_answer_keys') !== -1) return { status: 403, text: JSON.stringify({ code: '42501' }) };
    if (path.indexOf('/quiz_questions') !== -1 && method === 'DELETE') { deleted.push(path); return { status: 204, text: '' }; }
    return json([{ id: 'Q-9' }]);
  });

  try {
    await assert.rejects(() => quiz.saveQuestion('Z-1', questionFields()), (err) => {
      assert.strictEqual(err.code, 'KEY_NOT_SAVED');
      return true;
    });
    // 정답 없는 문제는 아무도 맞힐 수 없다. 반쪽짜리를 남기지 않는다.
    assert.strictEqual(deleted.length, 1);
    assert.match(deleted[0], /id=eq\.Q-9/);
  } finally {
    shim.restoreFetch();
  }
});

test('기존 문제 수정 중 정답 저장이 실패해도 문제를 지우지는 않는다', async () => {
  await load();
  const deleted = [];
  shim.installFetch(async (url, options) => {
    const path = String(url);
    const method = (options && options.method) || 'GET';
    if (path.indexOf('/quiz_answer_keys') !== -1) return { status: 403, text: JSON.stringify({ code: '42501' }) };
    if (path.indexOf('/quiz_questions') !== -1 && method === 'DELETE') { deleted.push(path); return { status: 204, text: '' }; }
    return json([{ id: 'Q-9' }]);
  });

  try {
    await assert.rejects(() => quiz.saveQuestion('Z-1', questionFields(), 'Q-9'), (err) => {
      assert.strictEqual(err.code, 'KEY_NOT_SAVED');
      return true;
    });
    assert.strictEqual(deleted.length, 0, '이미 있던 문제를 지우면 안 된다');
  } finally {
    shim.restoreFetch();
  }
});

test('응시 기록이 있는 문제 삭제는 이유를 알려준다', async () => {
  await load();
  server([{ match: '/quiz_questions', method: 'DELETE',
            reply: { status: 409, text: JSON.stringify({ code: '23503' }) } }]);

  try {
    await assert.rejects(() => quiz.deleteQuestion('Q-1'), (err) => {
      assert.strictEqual(err.code, 'IN_USE');
      assert.match(err.message, /응시 기록/);
      return true;
    });
  } finally {
    shim.restoreFetch();
  }
});

test('관리자 목록에서 정답을 꺼낸다', async () => {
  await load();
  assert.strictEqual(quiz.correctOptionOf({ quiz_answer_keys: [{ correct_option: 2 }] }), 2);
  assert.strictEqual(quiz.correctOptionOf({ quiz_answer_keys: { correct_option: 4 } }), 4);
  // 정답을 아직 넣지 않은 문제. 화면이 "미지정"으로 보여줄 수 있어야 한다.
  assert.strictEqual(quiz.correctOptionOf({ quiz_answer_keys: [] }), null);
  assert.strictEqual(quiz.correctOptionOf({}), null);
});

test('nextQuestionOrder는 가장 큰 순서 다음을 준다', async () => {
  await load();
  assert.strictEqual(quiz.nextQuestionOrder([]), 1);
  assert.strictEqual(quiz.nextQuestionOrder([{ question_order: 2 }, { question_order: 5 }]), 6);
  assert.strictEqual(quiz.nextQuestionOrder([{ question_order: null }]), 1);
});

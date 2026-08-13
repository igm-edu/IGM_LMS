import { ApiError, rest, rpc } from './api.js';

/**
 * 퀴즈.
 *
 * 수강생 쪽은 문제만 읽고 채점은 서버 함수에 맡긴다. 정답은 별도 테이블에
 * 있고 수강생 권한이 없으므로 여기서 정답을 다루는 코드는 아예 없다.
 * 관리자 쪽에서만 정답을 넣고 고친다.
 */

const QUESTION_FIELDS = 'id,question_order,question_text,option1,option2,option3,option4,score';

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isPercent(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (isBlank(value)) return false;
  const num = Number(value);
  return !isNaN(num) && num >= 0 && num <= 100;
}

export function validateQuiz(fields) {
  if (isBlank(fields.quiz_title)) return '퀴즈 제목을 입력해 주세요.';
  if (!isPercent(fields.pass_score)) return '합격 점수는 0~100 사이여야 합니다.';
  return null;
}

/**
 * 문항 검증.
 * 정답 번호가 비어 있는 보기를 가리키면 아무도 맞힐 수 없는 문제가 된다.
 * 오류 없이 전원 오답으로만 나타나므로 등록 시점에 막는다.
 */
export function validateQuestion(fields) {
  if (isBlank(fields.question_text)) return '문제를 입력해 주세요.';
  if (isBlank(fields.option1) || isBlank(fields.option2)) return '보기는 최소 두 개가 필요합니다.';

  const score = Number(fields.score);
  if (isBlank(fields.score) || isNaN(score) || score <= 0) return '배점은 0보다 큰 숫자여야 합니다.';

  const correct = Number(fields.correct_option);
  if (isNaN(correct) || correct < 1 || correct > 4 || correct !== Math.floor(correct)) {
    return '정답은 1~4 중 하나여야 합니다.';
  }
  if (isBlank(fields['option' + correct])) {
    return '정답으로 지정한 보기가 비어 있습니다.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 수강생
// ---------------------------------------------------------------------------

/** 차시에 딸린 퀴즈와 문제. 정답 열은 요청하지 않는다. */
export async function quizOfLesson(lessonId) {
  const rows = await rest('/quizzes?select=id,quiz_title,pass_score,quiz_questions(' + QUESTION_FIELDS + ')'
    + '&lesson_id=eq.' + lessonId
    + '&quiz_questions.order=question_order.asc'
    + '&order=created_at.asc');
  return rows && rows.length ? rows[0] : null;
}

export function myAttempts(quizId) {
  return rest('/quiz_attempts?select=id,score,is_passed,submitted_at'
    + '&quiz_id=eq.' + quizId + '&order=submitted_at.desc');
}

/**
 * 답안을 제출한다. 채점은 서버가 한다.
 * answers: [{ question_id, selected_option }]
 */
export async function submitQuiz(quizId, answers) {
  if (!Array.isArray(answers) || !answers.length) {
    throw new ApiError('BAD_REQUEST', '답을 하나 이상 선택해 주세요.');
  }
  const rows = await rpc('submit_quiz', { p_quiz_id: quizId, p_answers: answers });
  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '채점 결과를 받지 못했습니다.');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// 관리자
// ---------------------------------------------------------------------------

export async function saveQuiz(lessonId, fields, quizId) {
  const reason = validateQuiz(fields);
  if (reason) throw new ApiError('BAD_REQUEST', reason);

  const body = {
    quiz_title: String(fields.quiz_title).trim(),
    pass_score: Number(fields.pass_score),
  };
  const rows = quizId
    ? await rest('/quizzes?select=id,quiz_title,pass_score&id=eq.' + quizId,
        { method: 'PATCH', body: body, prefer: 'return=representation' })
    : await rest('/quizzes?select=id,quiz_title,pass_score',
        { method: 'POST', body: Object.assign({ lesson_id: lessonId }, body),
          prefer: 'return=representation' });

  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '저장되지 않았습니다. 권한을 확인해 주세요.');
  }
  return rows[0];
}

/** 관리자용. 문제와 정답을 함께 읽는다. */
export function listQuestionsWithKeys(quizId) {
  return rest('/quiz_questions?select=' + QUESTION_FIELDS + ',quiz_answer_keys(correct_option)'
    + '&quiz_id=eq.' + quizId + '&order=question_order.asc,id.asc');
}

export function correctOptionOf(question) {
  const keys = question && question.quiz_answer_keys;
  const key = Array.isArray(keys) ? keys[0] : keys;
  return key ? Number(key.correct_option) : null;
}

export function nextQuestionOrder(questions) {
  let max = 0;
  (questions || []).forEach(function (q) {
    const order = Number(q.question_order);
    if (!isNaN(order) && order > max) max = order;
  });
  return max + 1;
}

/**
 * 문제와 정답을 저장한다.
 *
 * 문제와 정답이 두 테이블에 나뉘어 있어 쓰기도 두 번이다. 문제만 저장되고
 * 정답이 실패하면 아무도 맞힐 수 없는 문제가 남으므로, 정답 저장이 실패하면
 * 그렇다고 알린다. 새로 만든 문제였다면 되돌려 반쪽짜리를 남기지 않는다.
 */
export async function saveQuestion(quizId, fields, questionId) {
  const reason = validateQuestion(fields);
  if (reason) throw new ApiError('BAD_REQUEST', reason);

  const body = {
    question_order: Number(fields.question_order),
    question_text: String(fields.question_text).trim(),
    option1: String(fields.option1).trim(),
    option2: String(fields.option2).trim(),
    option3: isBlank(fields.option3) ? null : String(fields.option3).trim(),
    option4: isBlank(fields.option4) ? null : String(fields.option4).trim(),
    score: Number(fields.score),
  };

  const rows = questionId
    ? await rest('/quiz_questions?select=id&id=eq.' + questionId,
        { method: 'PATCH', body: body, prefer: 'return=representation' })
    : await rest('/quiz_questions?select=id',
        { method: 'POST', body: Object.assign({ quiz_id: quizId }, body),
          prefer: 'return=representation' });

  if (!rows || !rows.length) {
    throw new ApiError('NOT_SAVED', '저장되지 않았습니다. 권한을 확인해 주세요.');
  }
  const saved = rows[0];

  try {
    await rest('/quiz_answer_keys?on_conflict=question_id&select=question_id', {
      method: 'POST',
      body: { question_id: saved.id, correct_option: Number(fields.correct_option) },
      prefer: 'resolution=merge-duplicates,return=representation',
    });
  } catch (err) {
    if (!questionId) {
      // 정답 없는 문제를 남기느니 지운다. 지우기까지 실패해도 원래 오류를 덮지 않는다.
      try { await rest('/quiz_questions?id=eq.' + saved.id, { method: 'DELETE' }); } catch (ignored) { /* 무시 */ }
    }
    throw new ApiError('KEY_NOT_SAVED', '정답을 저장하지 못했습니다. 다시 시도해 주세요.');
  }

  return saved;
}

/** 응시 기록이 있으면 DB 가 외래키로 거부한다(23503). */
export async function deleteQuestion(id) {
  try {
    await rest('/quiz_questions?id=eq.' + id, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof ApiError && err.code === '23503') {
      throw new ApiError('IN_USE', '이미 응시 기록이 있어 삭제할 수 없습니다.');
    }
    throw err;
  }
}

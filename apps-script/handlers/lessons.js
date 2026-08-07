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
      // 순서를 바꾸려 했는데 값이 이상하면 조용히 무시하지 않고 알린다.
      // 무시하면 관리자에게는 저장 성공으로 보이는데 순서는 그대로다.
      // 중복은 일부러 허용한다. 3번과 5번을 맞바꾸려면 중간에 같은 번호가 잠시 생긴다.
      if (isNaN(requested) || requested < 1) {
        throw appError_('BAD_REQUEST', '차시 순서는 1 이상의 숫자여야 합니다.');
      }
      order = requested;
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

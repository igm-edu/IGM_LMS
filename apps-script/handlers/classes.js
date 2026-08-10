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

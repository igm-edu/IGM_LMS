/**
 * 시트 이름과 헤더 정의. 이 파일이 스키마의 유일한 출처다.
 * 각 배열의 첫 항목이 그 시트의 기본키 열이다.
 */
var SHEETS = {
  Users: [
    'user_id', 'name', 'email', 'password_hash', 'phone', 'company', 'position',
    'birth_date', 'role', 'status', 'consent_at', 'retention_until', 'created_at',
  ],
  Sessions: ['token_hash', 'user_id', 'created_at', 'expires_at'],
  Classes: [
    'class_id', 'class_name', 'batch', 'instructor_id', 'start_date', 'end_date',
    'watch_rate_threshold', 'quiz_pass_score', 'quiz_retry_allowed', 'status',
  ],
  Enrollments: ['enrollment_id', 'user_id', 'class_id', 'enrolled_at', 'status'],
  Lessons: [
    'lesson_id', 'class_id', 'lesson_order', 'title', 'video_url', 'video_duration_sec',
  ],
  WatchLogs: [
    'watch_log_id', 'user_id', 'lesson_id', 'max_watched_sec', 'watch_rate',
    'completed', 'last_updated_at',
  ],
  Quizzes: ['quiz_id', 'lesson_id', 'quiz_title', 'pass_score'],
  QuizQuestions: [
    'question_id', 'quiz_id', 'question_text', 'option1', 'option2', 'option3',
    'option4', 'correct_option', 'score',
  ],
  QuizAttempts: ['attempt_id', 'user_id', 'quiz_id', 'score', 'is_passed', 'submitted_at'],
  QuizAnswers: ['answer_id', 'attempt_id', 'question_id', 'selected_option', 'is_correct'],
  Attendance: [
    'attendance_id', 'user_id', 'class_id', 'total_watch_rate', 'total_quiz_score',
    'is_completed', 'completed_at',
  ],
  Certificates: ['certificate_id', 'attendance_id', 'certificate_no', 'issued_at', 'file_id'],
  ErrorLog: ['log_id', 'occurred_at', 'action', 'user_id', 'message', 'stack'],
};

if (typeof module !== 'undefined') {
  module.exports = { SHEETS: SHEETS };
}

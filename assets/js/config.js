// Supabase 프로젝트 접속 정보.
//
// 두 값 모두 공개해도 되는 값이다. publishable 키는 브라우저에 실리는 것을
// 전제로 만들어졌고, 접근 제어는 전적으로 RLS 정책이 담당한다.
// (supabase/migrations/002_security.sql)
//
// secret 키(sb_secret_...)와 DB 비밀번호는 RLS를 전부 우회한다.
// 이 저장소는 공개이므로 그 둘은 절대 여기에 두지 않는다.
export const SUPABASE_URL = 'https://djaooyyyiwqaewyirdvq.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_hnDPiannz5bpdmr_Jb8eZg_InN07mDG';

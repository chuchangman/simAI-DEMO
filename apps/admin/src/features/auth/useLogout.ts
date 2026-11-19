import { authSession } from '@/lib/api';

// 화면은 바로 로그아웃하고 서버에 갱신 쿠키 폐기를 부탁한다. 캐시 비우기와 로그인 화면 이동은 main.tsx 의 세션 구독이 한다
// (401 로 끝날 때와 같은 길).
export function useLogout() {
  return authSession.logout;
}

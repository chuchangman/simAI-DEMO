import { useSessionStore } from '@/store/session.store';

/** 로그인한 계정의 역할. 화면은 세션 저장소 대신 이 훅을 쓴다. */
export function useCurrentRole() {
  return useSessionStore((s) => s.session?.user.role);
}

import { useSessionStore } from '@/store/session.store';

// 시연 계정. 이 계정은 「새 맵 만들기」가 준비된 맵으로 보정·생성을 10초 만에 채우고(demoNewMap), 3D 맵을 코드에 넣은 GLB 로 그린다(demoMap).
// 값은 로그인 응답의 user.id 다. 실서버는 user_id 숫자를 문자열로 주고('1' 이 실서버 시연 계정), 'demo' 는 mock 계정(mocks/accounts.ts)이다.
export const DEMO_USER_IDS: readonly string[] = ['demo', '1'];

// simAI-DEMO: 이 저장소는 시연 모드로만 보인다 — 로그인한 계정은 모두 시연 계정으로 본다. 시험(vitest)은 원래 판정을 쓴다.
const DEMO_ONLY = import.meta.env.MODE !== 'test';

export function isDemoUser(userId: string | undefined): boolean {
  return userId !== undefined && (DEMO_ONLY || DEMO_USER_IDS.includes(userId));
}

export function useIsDemoAccount(): boolean {
  return useSessionStore((s) => isDemoUser(s.session?.user.id));
}

import { DEMO_FLOW } from '@/mocks/demoFlow';
import type { Role } from '@/store/session.store';

export interface MockAccount {
  username: string;
  password: string;
  id: string;
  role: Role;
}

// 시연 계정(features/demo/demoAccount)
const DEMO_ACCOUNT: MockAccount = { username: 'demo', password: 'demo', id: 'demo', role: 'ADMIN' };

// 개발 서버 mock(VITE_API_MOCK=true)과 테스트에서만 받는 계정이다. 실제 서버 계정이 아니다.
// simAI-DEMO: 개발 서버는 시연 계정 하나만 받는다(mocks/demoFlow.ts). 시험은 원래 계정 전부.
export const MOCK_ACCOUNTS: readonly MockAccount[] = DEMO_FLOW
  ? [DEMO_ACCOUNT]
  : [
      { username: 'admin', password: 'admin', id: 'admin', role: 'ADMIN' },
      { username: 'foreman', password: 'foreman', id: 'foreman', role: 'FOREMAN' },
      { username: 'viewer', password: 'viewer', id: 'viewer', role: 'VIEWER' },
      DEMO_ACCOUNT,
    ];

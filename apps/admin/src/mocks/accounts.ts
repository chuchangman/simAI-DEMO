import type { Role } from '@/store/session.store';

export interface MockAccount {
  username: string;
  password: string;
  id: string;
  role: Role;
}

// 개발 서버 mock(VITE_API_MOCK=true)과 테스트에서만 받는 계정이다. 실제 서버 계정이 아니다.
export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  { username: 'admin', password: 'admin', id: 'admin', role: 'ADMIN' },
  { username: 'foreman', password: 'foreman', id: 'foreman', role: 'FOREMAN' },
  { username: 'viewer', password: 'viewer', id: 'viewer', role: 'VIEWER' },
  // 시연 계정(features/demo/demoAccount)
  { username: 'demo', password: 'demo', id: 'demo', role: 'ADMIN' },
];

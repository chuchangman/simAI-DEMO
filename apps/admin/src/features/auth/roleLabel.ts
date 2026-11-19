import type { Role } from '@/store/session.store';

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: '관리자',
  FOREMAN: '반장',
  VIEWER: '열람',
};

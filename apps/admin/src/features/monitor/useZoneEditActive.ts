import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { useZoneEditModeStore } from '@/store/zoneEditMode.store';

/** 관리자 편집 모드가 켜져 있는지. 편집은 관리자만 하므로 다른 역할은 켜져 있어도 아니다. */
export function useZoneEditActive(): boolean {
  const editing = useZoneEditModeStore((s) => s.editing);
  return useCurrentRole() === 'ADMIN' && editing;
}

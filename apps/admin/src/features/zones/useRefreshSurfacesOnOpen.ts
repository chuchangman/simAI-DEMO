import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * 구역 편집이 열릴 때 정적 객체 목록(작업면)을 다시 받는다. 다른 관리자가 그 사이 저장한 새 버전이 보이게 한다. 이미 받는
 * 중이면 그 응답을 쓴다.
 */
export function useRefreshSurfacesOnOpen() {
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: STATIC_OBJECTS_KEY }, { cancelRefetch: false });
  }, [queryClient]);
}

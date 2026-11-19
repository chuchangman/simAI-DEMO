import { STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { ZONES_KEY } from '@/features/zones/api';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/** 다른 화면에서 작업을 시작하거나 끝낸 경우에도 구역과 작업면을 다시 받는다. */
export function useWorkZonesRefresh(workId: string | undefined, ready: boolean) {
  const client = useQueryClient();
  const previous = useRef<{ id: string | undefined } | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (previous.current && previous.current.id !== workId) {
      void client.invalidateQueries({ queryKey: ZONES_KEY });
      void client.invalidateQueries({ queryKey: STATIC_OBJECTS_KEY });
    }
    previous.current = { id: workId };
  }, [client, ready, workId]);
}

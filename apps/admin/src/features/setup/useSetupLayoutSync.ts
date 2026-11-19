import { TBM_LAYOUTS_KEY, TBM_WORKS_KEY } from '@/features/tbm/api';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

export interface SetupLayoutSync {
  sessionId: string;
  sync: (zoneId: string, ignoreUnlinked?: boolean) => Promise<void>;
  retry: () => Promise<void>;
}

const resultSchema = z.object({ result: z.string() });

/** 구역 저장은 유지하고, 레이아웃 반영 실패만 별도로 재시도한다. */
export function useSetupLayoutSync(workId: number, sessionId: string | null) {
  const client = useQueryClient();
  const [failure, setFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const sync = useCallback(
    async (zoneId: string, ignoreUnlinked = false) => {
      try {
        await api(`/api/work-units/${workId}/layout/zones/${encodeURIComponent(zoneId)}`, {
          method: 'PUT',
          schema: resultSchema,
        });
        await Promise.all([
          client.invalidateQueries({ queryKey: TBM_WORKS_KEY }),
          client.invalidateQueries({ queryKey: TBM_LAYOUTS_KEY }),
          client.invalidateQueries({ queryKey: ['setup', 'layout-zones', String(workId)] }),
        ]);
      } catch (error) {
        if (!(
          ignoreUnlinked &&
          error instanceof ApiError &&
          error.code === 'SETUP_ZONE_NOT_LINKED'
        ))
          setFailure(true);
      }
    },
    [client, workId],
  );
  const retry = useCallback(async () => {
    if (!sessionId) return;
    setPending(true);
    setFailure(false);
    try {
      const zones = await api(`/api/work-units/${workId}/layout/zones`, {
        schema: z.array(z.string()),
      });
      for (const id of zones) await sync(id);
    } catch {
      setFailure(true);
    } finally {
      setPending(false);
    }
  }, [sessionId, sync, workId]);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    api(`/api/work-units/${workId}/layout/zones`, { schema: z.array(z.string()) })
      .then(async (zones) => {
        for (const id of zones) {
          if (!active) break;
          await sync(id);
        }
      })
      .catch(() => {
        if (active) setFailure(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId, sync, workId]);
  return { sync, retry, pending, failure };
}

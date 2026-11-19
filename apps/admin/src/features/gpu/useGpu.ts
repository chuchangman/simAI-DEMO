import { useCurrentRole } from '@/features/auth/useCurrentRole';
import {
  GPU_OFFERS_KEY,
  GPU_SETTINGS_KEY,
  GPU_STATUS_KEY,
  requestGpuLaunch,
  requestGpuOffers,
  requestGpuSettings,
  requestGpuStatus,
  requestGpuStop,
  requestSaveGpuSettings,
} from '@/features/gpu/api';
import {
  DEFAULT_AUTO_STOP_IDLE_MINUTES,
  gpuDot,
  isGpuOn,
  type GpuDot,
} from '@/features/gpu/gpuStatus';
import type {
  GpuLaunchBody,
  GpuOffers,
  GpuSettingsBody,
  GpuSettingsResponse,
  GpuStatus,
} from '@/features/gpu/types';
import { useTier0Connected } from '@/hooks/useTier0Connected';
import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

// GPU 상태·켜기·끄기·설정 훅(S15P31A101-702). 상태는 관리자만 받는다(서버가 ADMIN 만 허용). 다른 역할은 Tier 0 연결로만 점을 그린다.

/** 준비 중(켜는 중 포함)일 때 상태를 다시 받는 주기 */
export const GPU_POLL_FAST_MS = 3_000;
/** 그 밖의 주기 */
export const GPU_POLL_MS = 10_000;

export interface GpuStatusView {
  /** 관리자만 서버 상태가 있다 */
  isAdmin: boolean;
  status: GpuStatus | undefined;
  dot: GpuDot;
  /** 서버 시계 − 브라우저 시계(ms). 경과 시간을 서버 기준으로 잰다 */
  clockOffsetMs: number;
}

export function useGpuStatus(): GpuStatusView {
  const isAdmin = useCurrentRole() === 'ADMIN';
  const tier0Connected = useTier0Connected();
  const query = useQuery({
    queryKey: GPU_STATUS_KEY,
    queryFn: async ({ signal }) => {
      const status = await requestGpuStatus(api, signal);
      return { status, offsetMs: status.server_time_ms - Date.now() };
    },
    enabled: isAdmin,
    refetchInterval: (q) => {
      const power = q.state.data?.status.power;
      return power === 'STARTING' || power === 'PREPARING' ? GPU_POLL_FAST_MS : GPU_POLL_MS;
    },
  });
  const status = isAdmin ? query.data?.status : undefined;
  return {
    isAdmin,
    status,
    dot: gpuDot(status, tier0Connected),
    clockOffsetMs: query.data?.offsetMs ?? 0,
  };
}

/**
 * 이미 받아 둔 GPU 상태만 읽는다(새로 요청하지 않는다, S15P31A101-706). 관리자 화면은 상단바 GPU 점이 늘 받아 둔다.
 * 사건 상세처럼 상태 요청을 늘리지 않을 곳이 쓴다. 관리자가 아니면 없음.
 */
export function useCachedGpuStatus(): GpuStatus | undefined {
  const isAdmin = useCurrentRole() === 'ADMIN';
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  const data = useSyncExternalStore(subscribe, () =>
    client.getQueryData<{ status: GpuStatus }>(GPU_STATUS_KEY),
  );
  return isAdmin ? data?.status : undefined;
}

/**
 * GPU 가 꺼져 있다고 확실히 아는지(받아 둔 상태가 있고 켜져 있지도 켜는 중도 아님, S15P31A101-752). 상태를 모르면(관리자가 아니거나 아직 못 받음)
 * false 라 「꺼짐」을 지어내지 않는다. 새로 요청하지 않는다.
 */
export function useGpuKnownOff(): boolean {
  const status = useCachedGpuStatus();
  return status !== undefined && !isGpuOn(status);
}

/** 이미 받아 둔 GPU 설정의 유휴 자동 정지 분만 읽는다(없으면 서버 기본 30분) */
export function useCachedGpuIdleMinutes(): number {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  const data = useSyncExternalStore(subscribe, () =>
    client.getQueryData<GpuSettingsResponse>(GPU_SETTINGS_KEY),
  );
  return data?.settings.auto_stop_idle_minutes ?? DEFAULT_AUTO_STOP_IDLE_MINUTES;
}

/** 이미 받아 둔 GPU 재고 표만 읽는다(새로 요청하지 않음) */
export function useCachedGpuOffers(): GpuOffers | undefined {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client],
  );
  return useSyncExternalStore(subscribe, () => client.getQueryData<GpuOffers>(GPU_OFFERS_KEY));
}

/** 켜기 패널의 재고·가격 표. 패널을 열 때만 받는다(공급자 API 를 부른다) */
export function useGpuOffers(enabled: boolean) {
  const query = useQuery({
    queryKey: GPU_OFFERS_KEY,
    queryFn: ({ signal }) => requestGpuOffers(api, signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return {
    offers: query.data,
    pending: query.isPending && enabled,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useGpuLaunch() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: GpuLaunchBody) => requestGpuLaunch(api, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: GPU_STATUS_KEY }),
  });
  return {
    launch: mutation.mutate,
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useGpuStop() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => requestGpuStop(api),
    onSettled: () => queryClient.invalidateQueries({ queryKey: GPU_STATUS_KEY }),
  });
  return {
    stop: mutation.mutate,
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useGpuSettings(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: GPU_SETTINGS_KEY,
    queryFn: ({ signal }) => requestGpuSettings(api, signal),
    enabled,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: (body: GpuSettingsBody) => requestSaveGpuSettings(api, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GPU_SETTINGS_KEY }),
  });
  return {
    data: query.data,
    loading: query.isPending && enabled,
    loadError: query.error,
    save: save.mutate,
    saving: save.isPending,
    saveError: save.error,
    saved: save.isSuccess,
  };
}

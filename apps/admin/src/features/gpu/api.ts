import {
  gpuLaunchSchema,
  gpuOffersSchema,
  gpuSettingsResponseSchema,
  gpuSettingsSchema,
  gpuStatusSchema,
  type GpuLaunch,
  type GpuLaunchBody,
  type GpuOffers,
  type GpuSettings,
  type GpuSettingsBody,
  type GpuSettingsResponse,
  type GpuStatus,
} from '@/features/gpu/types';
import type { Http } from '@/lib/http';
import { z } from 'zod';

// GPU 켜기·끄기·설정 REST(S15P31A101-702). http 를 인자로 받는다(테스트가 env 없이 부를 수 있게).

export const GPU_KEY = ['gpu'] as const;
export const GPU_STATUS_KEY = [...GPU_KEY, 'status'] as const;
export const GPU_OFFERS_KEY = [...GPU_KEY, 'offers'] as const;
export const GPU_SETTINGS_KEY = [...GPU_KEY, 'settings'] as const;

/** 서버 오류 코드(ErrorCode.Gpu, -702). 화면이 구분해 안내한다 */
export const GPU_ERROR = {
  ALREADY_ON: 'GPU_ALREADY_ON',
  NOT_ON: 'GPU_NOT_ON',
  OUT_OF_STOCK: 'GPU_OUT_OF_STOCK',
  PRICE_OVER_CAP: 'GPU_PRICE_OVER_CAP',
  STOP_BLOCKED_LIVE: 'GPU_STOP_BLOCKED_LIVE',
  STOP_BLOCKED_SETUP: 'GPU_STOP_BLOCKED_SETUP',
  STOP_UNSUPPORTED: 'GPU_STOP_UNSUPPORTED',
  NOT_CONFIGURED: 'GPU_PROVIDER_NOT_CONFIGURED',
  PROVIDER_ERROR: 'GPU_PROVIDER_ERROR',
  INVALID_SETTINGS: 'INVALID_GPU_SETTINGS',
} as const;

export const requestGpuStatus = (http: Http, signal?: AbortSignal): Promise<GpuStatus> =>
  http('/api/gpu/sessions/current', { schema: gpuStatusSchema, signal });

export const requestGpuOffers = (http: Http, signal?: AbortSignal): Promise<GpuOffers> =>
  http('/api/gpu/offers', { schema: gpuOffersSchema, signal });

export const requestGpuLaunch = (http: Http, body: GpuLaunchBody): Promise<GpuLaunch> =>
  http('/api/gpu/launches', { method: 'POST', body, schema: gpuLaunchSchema });

export const requestGpuStop = (http: Http): Promise<unknown> =>
  http('/api/gpu/stop', { method: 'POST', schema: z.unknown() });

/** 관리자 화면 조작 신호(S15P31A101-708). 서버는 마지막 시각만 메모리에 두고 Tier 0 연결 중 자동 정지의 사용으로 센다 */
export const requestGpuPresence = (http: Http): Promise<unknown> =>
  http('/api/gpu/presence', { method: 'POST', schema: z.unknown() });

export const requestGpuSettings = (
  http: Http,
  signal?: AbortSignal,
): Promise<GpuSettingsResponse> =>
  http('/api/gpu/settings', { schema: gpuSettingsResponseSchema, signal });

export const requestSaveGpuSettings = (http: Http, body: GpuSettingsBody): Promise<GpuSettings> =>
  http('/api/gpu/settings', { method: 'POST', body, schema: gpuSettingsSchema });

import type { ViewerHealthPayload } from '@simai/contracts';
import { z } from 'zod';

// Tier 0 처리 지연(ms). 상단 바와 CCTV 칸이 같이 쓴다. 화면 컴포넌트 없이 시험한다.
// Tier 0 가 자기 시계로 잰 T_lag(I1 health.pipeline_lag_ms, 명세 6.1: 노트북 촬영 시각을 laptop_clock_offset 으로 Tier 0 시계에
// 옮겨 판정 시각에서 뺀 값)만 쓴다. 브라우저 시계로 촬영 시각을 빼면 노트북·EC2·브라우저 시계 차이가 섞여 쓰지 않는다.
// 카메라별 값은 같은 health 의 pipeline_lag_ms + (t_latest_global − cameras[].last_capture) 다. 두 시각이 모두 노트북 촬영 시각이라
// 그 차이에는 시계 차이가 없다(그 카메라의 마지막 처리 프레임이 판정 시각에 얼마나 묵었는지). cameras[].frame_age_ms 는 Tier 0 가
// 싣지 않고, 실려도 노트북 촬영 시각을 시계 보정 없이 Tier 0 시각에서 뺀 값이라 쓰지 않는다.
// 모르면(Tier 0 끊김·pipeline_lag_ms null·형식 틀림) 비운다(지어내지 않음, AGENTS 규칙 2).

/** 지연 색을 쓰는 기준(ms). 명세 6.1 System Health lag DEGRADED 기준 600ms(6.6 capture_to_risk p95) 이상이면 지연이다. */
export const LAG_WARN_MS = 600;

/** 이보다 작으면(ms) 정상(초록)이다. 카메라 칸 배지의 세 단계 색 기준(S15P31A101-704 사용자 결정). */
export const LAG_OK_MS = 300;

/** 보이는 값은 최근 이 시간(ms, EC2 시계 as_of 기준) 동안 받은 값의 평균이다. 1 Hz 값이 덜 튀게 한다. */
export const LAG_WINDOW_MS = 5000;

export interface LagSample {
  /** viewer_health.as_of(EC2 시계 ms). */
  at: number;
  /** I1 health.pipeline_lag_ms. */
  lagMs: number;
  /** 카메라별 판정 시각 기준 지연(ms). 촬영 시각을 모르는 카메라는 없다. */
  cameras: Readonly<Record<string, number>>;
}

const tier0Schema = z.object({
  // null(모름)이거나 수가 아니면 표본을 만들지 않는다.
  pipeline_lag_ms: z.number().min(0),
  t_latest_global: z.number().nullish().catch(undefined),
  cameras: z.array(z.unknown()).nullish().catch(undefined),
});

const cameraSchema = z.object({
  id: z.string(),
  last_capture: z.number().nullish().catch(undefined),
});

const EMPTY: readonly LagSample[] = [];

/** viewer_health 한 건의 지연 표본. Tier 0 와 끊겼거나 T_lag 를 모르면 null. */
export function lagSample(payload: ViewerHealthPayload): LagSample | null {
  if (payload.tier0_link !== 'CONNECTED') return null;
  const tier0 = tier0Schema.safeParse(payload.tier0_health);
  if (!tier0.success) return null;
  const { pipeline_lag_ms: lagMs, t_latest_global: latest, cameras } = tier0.data;
  const perCamera: Record<string, number> = {};
  if (typeof latest === 'number') {
    for (const item of cameras ?? []) {
      const camera = cameraSchema.safeParse(item);
      if (!camera.success || typeof camera.data.last_capture !== 'number') continue;
      perCamera[camera.data.id] = Math.max(0, lagMs + latest - camera.data.last_capture);
    }
  }
  return { at: payload.as_of, lagMs, cameras: perCamera };
}

/**
 * 표본 창에 새 표본을 더한다. 새 표본보다 창 길이 넘게 오래된 것과 같은·더 새 시각(as_of 가 뒤로 간 EC2 재시작 등)의 것은 버린다.
 * 새 표본이 없으면(모름) 창을 비운다: 끊긴 동안의 평균을 지금 값처럼 보이지 않는다.
 */
export function pushLagSample(
  samples: readonly LagSample[],
  sample: LagSample | null,
  windowMs = LAG_WINDOW_MS,
): readonly LagSample[] {
  if (!sample) return EMPTY;
  return [...samples.filter((s) => s.at < sample.at && s.at > sample.at - windowMs), sample];
}

const mean = (values: readonly number[]) =>
  values.length === 0
    ? undefined
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

/** 창 평균 Tier 0 처리 지연(ms, 정수). 표본이 없으면 undefined. */
export function averageLag(samples: readonly LagSample[]): number | undefined {
  return mean(samples.map((s) => s.lagMs));
}

/** 창 평균 카메라 지연(ms, 정수). 가장 새 표본에 그 카메라 값이 없으면(지금 모름) undefined. */
export function averageCameraLag(
  samples: readonly LagSample[],
  cameraId: string,
): number | undefined {
  if (samples.at(-1)?.cameras[cameraId] === undefined) return undefined;
  return mean(samples.flatMap((s) => s.cameras[cameraId] ?? []));
}

/** 지연 단계. ok: LAG_OK_MS 미만(초록), warn: LAG_WARN_MS 미만(노랑), high: 그 이상(빨강). */
export type LagLevel = 'ok' | 'warn' | 'high';

export function lagLevel(ms: number): LagLevel {
  if (ms < LAG_OK_MS) return 'ok';
  if (ms < LAG_WARN_MS) return 'warn';
  return 'high';
}

/** 지연 색(기준 이상)을 쓸지. */
export const isLagHigh = (ms: number) => lagLevel(ms) === 'high';

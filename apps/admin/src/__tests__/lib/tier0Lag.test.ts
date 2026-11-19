import {
  averageCameraLag,
  averageLag,
  isLagHigh,
  LAG_WINDOW_MS,
  lagLevel,
  lagSample,
  pushLagSample,
  type LagSample,
} from '@/lib/tier0Lag';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import type { ViewerHealthPayload } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

const T = 1_760_342_400_000;

/** mock health 에 Tier 0 health 만 바꿔 넣는다. */
function payload(
  tier0: Record<string, unknown> | null,
  change: Partial<ViewerHealthPayload> = {},
): ViewerHealthPayload {
  return { ...viewerHealthAt(T).payload, as_of: T, tier0_health: tier0, ...change };
}

const tier0 = (lag: number | null) => ({
  pipeline_lag_ms: lag,
  t_latest_global: T - 100,
  cameras: [
    { id: 'cam_A', status: 'OK', last_capture: T - 100 },
    { id: 'cam_B', status: 'OK', last_capture: T - 160 },
    { id: 'cam_C', status: 'NO_SIGNAL', last_capture: null },
  ],
});

const sample = (at: number, lagMs: number, cameras: Record<string, number> = {}): LagSample => ({
  at,
  lagMs,
  cameras,
});

describe('lagSample', () => {
  it('Tier 0 가 잰 pipeline_lag_ms 를 쓰고, 카메라별 값은 같은 health 의 t_latest_global 과 촬영 시각 차이를 더한다', () => {
    expect(lagSample(payload(tier0(180)))).toEqual({
      at: T,
      lagMs: 180,
      // cam_A 은 가장 새 촬영이라 T_lag 그대로, cam_B 는 60ms 더 묵었다. 촬영 시각이 없는 cam_C 는 없다.
      cameras: { cam_A: 180, cam_B: 240 },
    });
  });

  it('T_lag 를 모르거나(null) Tier 0 와 끊겼거나 형식이 틀리면 표본을 만들지 않는다', () => {
    expect(lagSample(payload(tier0(null)))).toBeNull();
    expect(lagSample(payload(tier0(180), { tier0_link: 'DISCONNECTED' }))).toBeNull();
    expect(lagSample(payload(null))).toBeNull();
    expect(lagSample(payload({ pipeline_lag_ms: 'x' }))).toBeNull();
  });

  it('t_latest_global 을 모르면 카메라별 값은 비우고 전체 값만 둔다', () => {
    expect(lagSample(payload({ ...tier0(180), t_latest_global: null }))).toEqual({
      at: T,
      lagMs: 180,
      cameras: {},
    });
  });

  it('카메라 촬영 시각이 t_latest_global 보다 새도 지연은 0 아래로 내려가지 않는다', () => {
    const doc = { ...tier0(10), cameras: [{ id: 'cam_A', status: 'OK', last_capture: T }] };
    expect(lagSample(payload(doc))?.cameras).toEqual({ cam_A: 0 });
  });
});

describe('pushLagSample · 평균', () => {
  it('창 길이 안의 표본만 두고 평균을 정수로 낸다', () => {
    let samples: readonly LagSample[] = [];
    samples = pushLagSample(samples, sample(T, 100, { cam_A: 150 }));
    samples = pushLagSample(samples, sample(T + 1000, 201, { cam_A: 250 }));
    expect(averageLag(samples)).toBe(151);
    expect(averageCameraLag(samples, 'cam_A')).toBe(200);

    samples = pushLagSample(samples, sample(T + LAG_WINDOW_MS + 500, 300, { cam_A: 300 }));
    // T 표본은 창 밖으로 빠진다.
    expect(samples.map((s) => s.at)).toEqual([T + 1000, T + LAG_WINDOW_MS + 500]);
  });

  it('모르는 표본(null)이 오면 창을 비운다', () => {
    const samples = pushLagSample([sample(T, 100)], null);
    expect(samples).toEqual([]);
    expect(averageLag(samples)).toBeUndefined();
  });

  it('같거나 더 이른 as_of 의 표본(같은 health 다시 받음·EC2 재시작)은 새 표본으로 바꾼다', () => {
    const samples = pushLagSample([sample(T, 100), sample(T + 1000, 200)], sample(T + 1000, 400));
    expect(samples).toEqual([sample(T, 100), sample(T + 1000, 400)]);
    expect(pushLagSample(samples, sample(T - 9000, 50))).toEqual([sample(T - 9000, 50)]);
  });

  it('가장 새 표본에 그 카메라 값이 없으면 카메라 지연은 모른다', () => {
    const samples = [sample(T, 100, { cam_A: 150 }), sample(T + 1000, 100, {})];
    expect(averageCameraLag(samples, 'cam_A')).toBeUndefined();
  });

  it('명세 6.1 DEGRADED 기준(600ms) 이상이면 지연 색이다', () => {
    expect(isLagHigh(599)).toBe(false);
    expect(isLagHigh(600)).toBe(true);
  });

  it('지연 단계는 300ms 미만 초록, 600ms 미만 노랑, 그 이상 빨강이다(S15P31A101-704)', () => {
    expect(lagLevel(0)).toBe('ok');
    expect(lagLevel(299)).toBe('ok');
    expect(lagLevel(300)).toBe('warn');
    expect(lagLevel(599)).toBe('warn');
    expect(lagLevel(600)).toBe('high');
    expect(lagLevel(2000)).toBe('high');
  });
});

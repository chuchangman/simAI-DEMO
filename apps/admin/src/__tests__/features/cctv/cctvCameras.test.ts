import { cameraState, showsState, tileBadge } from '@/features/cctv/cctv';
import { healthCameras } from '@/features/cctv/cctvCameras';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import type { HealthSnapshot } from '@/store/realtime.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

// T 는 mock 바퀴(40초)의 0초라 카메라 4대가 정상이다. T + 20초부터 6초 동안 cam_C 가 키프레임을 기다린다.
const T = 1_760_342_400_000;

function snapshot(t = T, change: Partial<ViewerHealthPayload> = {}): HealthSnapshot {
  return { payload: { ...viewerHealthAt(t).payload, ...change }, receivedAt: t, clockOffsetMs: 0 };
}

describe('healthCameras', () => {
  it('tier0_health.cameras 의 id·status·last_capture 를 읽는다', () => {
    const cameras = healthCameras(snapshot());
    expect(cameras.map((camera) => camera.id)).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
    expect(cameras[0]).toEqual({ id: 'cam_A', status: 'OK', lastCaptureMs: T - 120 });
  });

  it('키프레임을 기다리는 카메라는 status 만 있고 촬영 시각이 없다', () => {
    const cam_C = healthCameras(snapshot(T + 20_000)).find((camera) => camera.id === 'cam_C');
    expect(cam_C).toEqual({ id: 'cam_C', status: 'WAITING_KEYFRAME', lastCaptureMs: undefined });
  });

  it('health 가 없거나 Tier 0 와 끊겼으면 비운다', () => {
    expect(healthCameras(null)).toEqual([]);
    expect(healthCameras(snapshot(T, { tier0_link: 'DISCONNECTED' }))).toEqual([]);
  });

  it('형식이 틀린 칸은 그 칸만 비우고 id 가 없는 카메라는 뺀다', () => {
    const health = snapshot(T, {
      tier0_health: {
        cameras: [
          { id: 'cam_A', status: 7, last_capture: 'x' },
          { status: 'OK' },
          { id: 'cam_B', status: 'NO_SIGNAL', last_capture: null },
        ],
      },
    });
    expect(healthCameras(health)).toEqual([
      { id: 'cam_A', status: undefined, lastCaptureMs: undefined },
      { id: 'cam_B', status: 'NO_SIGNAL', lastCaptureMs: undefined },
    ]);
    expect(healthCameras(snapshot(T, { tier0_health: { cameras: 'x' } }))).toEqual([]);
  });
});

describe('cameraState', () => {
  const camera = (status?: string) => ({ id: 'cam_A', status });

  it('status OK 이고 World 가 들어오면 실시간이다', () => {
    expect(cameraState(camera('OK'), true)).toBe('live');
  });

  it('시각 동기만 무효인 카메라(SYNC_INVALID)는 프레임이 들어오므로 실시간이다', () => {
    expect(cameraState(camera('SYNC_INVALID'), true)).toBe('live');
  });

  it.each(['NO_SIGNAL', 'WAITING_KEYFRAME'])(
    '%s 는 끊김이다(World 가 멈춰도 끊김이 먼저)',
    (status) => {
      expect(cameraState(camera(status), true)).toBe('down');
      expect(cameraState(camera(status), false)).toBe('down');
    },
  );

  it('World 가 멈췄거나 카메라·상태를 알 수 없으면 정지다', () => {
    expect(cameraState(camera('OK'), false)).toBe('frozen');
    expect(cameraState(undefined, true)).toBe('frozen');
    expect(cameraState(camera(undefined), true)).toBe('frozen');
  });

  it('정지는 배지를 두지 않고 끊김·실시간은 둔다', () => {
    expect(showsState('frozen')).toBe(false);
    expect(showsState('down')).toBe(true);
    expect(showsState('live')).toBe(true);
  });
});

describe('tileBadge (S15P31A101-704)', () => {
  it('Tier 0 와 이어졌으면 실시간 칸은 지연과 색 단계를, 끊긴 칸은 끊김을 보인다', () => {
    expect(tileBadge(true, 'live', 180)).toEqual({ kind: 'lag', ms: 180, level: 'ok' });
    expect(tileBadge(true, 'live', 450)).toEqual({ kind: 'lag', ms: 450, level: 'warn' });
    expect(tileBadge(true, 'live', 600)).toEqual({ kind: 'lag', ms: 600, level: 'high' });
    expect(tileBadge(true, 'down', 180)).toEqual({ kind: 'down' });
  });

  it('지연을 모르는 실시간 칸과 정지 칸은 배지를 두지 않는다', () => {
    expect(tileBadge(true, 'live', undefined)).toBeNull();
    expect(tileBadge(true, 'frozen', 180)).toBeNull();
  });

  it('Tier 0(GPU)가 이어지지 않았으면 끊김도 지연도 보이지 않는다', () => {
    expect(tileBadge(false, 'down', undefined)).toBeNull();
    expect(tileBadge(false, 'live', 180)).toBeNull();
  });
});

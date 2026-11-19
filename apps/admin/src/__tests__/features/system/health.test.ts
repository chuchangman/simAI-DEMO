import { cameraRows } from '@/features/system/health';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import type { HealthSnapshot } from '@/store/realtime.store';
import type { ViewerHealthMessage, ViewerHealthPayload } from '@simai/contracts';
import { describe, expect, it } from 'vitest';

// T 는 mock 바퀴(40초)의 0초라 카메라 4대가 정상이다. T + 20초부터 6초 동안 cam_C 가 키프레임을 기다린다.
const T = 1_760_342_400_000;

function snapshot(t = T, change: Partial<ViewerHealthPayload> = {}): HealthSnapshot {
  return { payload: { ...viewerHealthAt(t).payload, ...change }, receivedAt: t, clockOffsetMs: 0 };
}

// 저장소 루트 contracts/ 의 정본 예제. 손으로 옮겨 적지 않고 그대로 읽는다.
const EXAMPLES = import.meta.glob<{ default: ViewerHealthMessage }>(
  '../../../../../../../contracts/examples/viewer_health*.json',
  { eager: true },
);

function example(file: string): HealthSnapshot {
  const found = Object.entries(EXAMPLES).find(([path]) => path.endsWith(`/${file}.json`));
  if (!found) throw new Error(`계약 예제 ${file} 가 없다`);
  return { payload: structuredClone(found[1].default).payload, receivedAt: T, clockOffsetMs: 0 };
}

const tier0Lost = (t = T) =>
  snapshot(t, { tier0_link: 'DISCONNECTED', system_health: 'UNSAFE_UNKNOWN' });

describe('cameraRows', () => {
  it('카메라별 상태·FPS·시각 차이·손실 3종·큐 대기를 단위와 함께 만든다', () => {
    const rows = cameraRows(snapshot());
    expect(rows.map((row) => row.id)).toEqual(['cam_A', 'cam_B', 'cam_C', 'cam_D']);
    expect(rows[0]).toEqual({
      id: 'cam_A',
      status: '정상',
      ok: true,
      fps: '14.6',
      syncOffset: '4 ms',
      gapMax: '70 ms',
      runpodLoss: '0',
      skipped: '10',
      queueWaitP95: '36 ms',
    });
    expect(rows[1]).toMatchObject({
      fps: '14.9',
      gapMax: '100 ms',
      runpodLoss: '1',
      queueWaitP95: '48 ms',
    });
  });

  it('계약 예제를 칸마다 그대로 옮긴다', () => {
    const [cam_A, cam_B] = cameraRows(example('viewer_health'));
    expect(cam_A).toEqual({
      id: 'cam_A',
      status: '정상',
      ok: true,
      fps: '14.8',
      syncOffset: '6 ms',
      gapMax: '80 ms',
      runpodLoss: '0',
      skipped: '10',
      queueWaitP95: '40 ms',
    });
    expect(cam_B).toEqual({ id: 'cam_B', status: '키프레임 대기', ok: false, fps: '0.0' });
  });

  it('키프레임을 기다리는 카메라는 처리 FPS 0 을 그대로 보이고, 잴 수 없는 칸은 비운다', () => {
    const cam_C = cameraRows(snapshot(T + 20_000)).find((row) => row.id === 'cam_C');
    expect(cam_C).toEqual({
      id: 'cam_C',
      status: '키프레임 대기',
      ok: false,
      fps: '0.0',
      syncOffset: undefined,
      gapMax: undefined,
      runpodLoss: undefined,
      skipped: undefined,
      queueWaitP95: undefined,
    });
  });

  it('실제 0 은 0 으로 보인다', () => {
    const [camera] = cameraRows(
      snapshot(T, {
        tier0_health: {
          cameras: [
            {
              id: 'c',
              status: 'OK',
              fps: 15,
              sync_offset_ms: 0,
              queue_wait_ms: { p50: 0, p95: 0 },
              frames: {
                camera_to_gateway_gap_max_ms: 0,
                gateway_to_runpod_loss: 0,
                skipped_by_policy: 0,
              },
            },
          ],
        },
      }),
    );
    expect(camera).toMatchObject({
      fps: '15.0',
      syncOffset: '0 ms',
      gapMax: '0 ms',
      runpodLoss: '0',
      skipped: '0',
      queueWaitP95: '0 ms',
    });
  });

  it.each([
    ['OK', '정상'],
    ['NO_SIGNAL', '신호 없음'],
    ['WAITING_KEYFRAME', '키프레임 대기'],
    ['SYNC_INVALID', '동기 불가'],
  ])('상태 %s 는 "%s" 다', (status, label) => {
    const [camera] = cameraRows(snapshot(T, { tier0_health: { cameras: [{ id: 'c', status }] } }));
    expect(camera).toMatchObject({ status: label, ok: status === 'OK' });
  });

  it('형식이 틀린 칸만 비우고, 모르는 상태는 그대로 보이고, id 가 없는 카메라만 뺀다', () => {
    const health = snapshot(T, {
      tier0_health: {
        cameras: [
          {
            id: 'cam_A',
            status: 'REBOOTING',
            fps: '15',
            sync_offset_ms: 4,
            frames: { gateway_to_runpod_loss: 'x', skipped_by_policy: 3 },
          },
          { id: 'cam_B', status: 7, queue_wait_ms: 'slow', frames: 'x' },
          { id: 3, status: 'OK' },
          'x',
        ],
      },
    });
    expect(cameraRows(health)).toEqual([
      { id: 'cam_A', status: 'REBOOTING', ok: false, syncOffset: '4 ms', skipped: '3' },
      { id: 'cam_B', ok: false },
    ]);
  });

  it('health·tier0_health 가 없거나 cameras 가 배열이 아니면 카메라가 없다', () => {
    expect(cameraRows(null)).toEqual([]);
    expect(cameraRows(snapshot(T, { tier0_health: null }))).toEqual([]);
    expect(cameraRows(snapshot(T, { tier0_health: { cameras: 'x' } }))).toEqual([]);
  });

  it('EC2 ↔ Tier 0 가 끊기면 마지막으로 받은 카메라를 지금 값처럼 보이지 않는다', () => {
    expect(cameraRows(tier0Lost())).toEqual([]);
  });
});

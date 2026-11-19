import { adaptDemoZones, adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  eventTargetsTrack,
  trackPlacement,
  type TrackView,
} from '@/features/viewer3d/data/spatialFrame';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { describe, expect, it } from 'vitest';

// 저장소 루트 contracts/ 의 정본 예제. 손으로 옮겨 적지 않고 그대로 읽는다.
const ALL_VALID = import.meta.glob<{ default: unknown }>(
  '../../../../../../../contracts/examples/{world_state,risk_event,viewer_health,avatar_frame}*.json',
  { eager: true },
);
const ALL_INVALID = import.meta.glob<{ default: unknown }>(
  '../../../../../../../contracts/examples/invalid/{world_state,risk_event,viewer_health,avatar_frame}*.json',
  { eager: true },
);
const name = (path: string) => path.split('/').pop()!.replace('.json', '');
// risk_event_transition(I1) 처럼 이름만 앞이 같은 다른 메시지는 뺀다.
const VIEWER_TYPES = ['world_state', 'risk_event', 'viewer_health', 'avatar_frame'];
const onlyViewer = (files: typeof ALL_VALID) =>
  Object.fromEntries(
    Object.entries(files).filter(([path]) => VIEWER_TYPES.includes(name(path).split('.')[0]!)),
  );
const VALID = onlyViewer(ALL_VALID);
const INVALID = onlyViewer(ALL_INVALID);
const example = (file: string) =>
  structuredClone(Object.entries(VALID).find(([path]) => name(path) === file)![1].default);

const worldExample = () => {
  const result = adaptMessage(example('world_state'), 1000);
  if (result.kind !== 'world') throw new Error(result.kind);
  return result.frame;
};

describe('정본 예제', () => {
  it('정상 예제는 모두 통과하고 msg_type 에 맞는 View Model 이 된다', () => {
    const files = Object.keys(VALID).map(name);
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const [path, mod] of Object.entries(VALID)) {
      const result = adaptMessage(structuredClone(mod.default), 0);
      const type = name(path).split('.')[0];
      const expected = {
        world_state: 'world',
        risk_event: 'event',
        viewer_health: 'health',
        avatar_frame: 'avatar',
      }[type!];
      expect([name(path), result.kind]).toEqual([name(path), expected]);
    }
  });

  it('/topic/avatar(avatar_frame)는 사람별 관절 회전·자산만 옮기고 위치는 싣지 않는다(-65)', () => {
    const result = adaptMessage(example('avatar_frame'), 5);
    if (result.kind !== 'avatar') throw new Error(result.kind);
    expect(result.frame.msgId).toBe('7f1c2a10-4b6e-4c1d-9a2b-000000000252');
    expect(result.frame.dropped).toEqual([]);
    const [first] = result.frame.avatars;
    expect(first).toMatchObject({
      worldId: 'w-0012',
      identityRevision: 2,
      captureTimeMs: 1760342400100,
      receivedAt: 5,
      calibrationVersion: 'cal-7',
      rootRotation: [1.5192, 0.47, 0.47],
      asset: { jointCount: 127, pelvisJointIndex: 1, meshFormat: 'GLB_SKINNED' },
    });
    expect(first!.jointRotations).toHaveLength(127);
    expect(first!.jointRotations[43]).toBeNull();
    expect(Object.keys(first!)).not.toContain('position');
  });

  it('잘못된 예제는 모두 계약 오류로 거부한다', () => {
    expect(Object.keys(INVALID).length).toBeGreaterThanOrEqual(20);
    for (const [path, mod] of Object.entries(INVALID)) {
      const result = adaptMessage(structuredClone(mod.default), 0);
      expect([name(path), result.kind]).toEqual([name(path), 'rejected']);
    }
  });
});

describe('World 값 보존', () => {
  it('ID·시각·관측 상태·별칭·validity 를 그대로 옮긴다', () => {
    const frame = worldExample();
    expect(frame.meta).toEqual({
      msgId: '0192a6f0-7c1e-7b3a-9f2d-3c4b5a6d7e8f',
      schemaVersion: '2.0.0',
      sourceId: 'tier0-01',
      sentAt: 1760342400123,
      receivedAt: 1000,
    });
    expect(frame.tLatestGlobal).toBe(1760342400100);
    expect([frame.calibrationVersion, frame.sceneVersion, frame.configVersion]).toEqual([
      'cal-7',
      'scene-3',
      'cfg-12',
    ]);
    const [a, b] = frame.tracks as [TrackView, TrackView];
    expect(a).toMatchObject({
      worldId: 'w-0012',
      tLastValid: 1760342400080,
      observationState: 'OBSERVED',
      lifecycle: 'CONFIRMED',
      identityRevision: 2,
      aliases: ['w-0009', 'w-0011'],
      splitFrom: null,
      pelvis: [3.4, 5.01, 0.92],
      groundAnchor: [3.41, 5.02, 0],
      surfaceSource: 'observed',
      zValidity: 'VALID',
      headZ: 1.68,
      headZValidity: 'VALID',
    });
    // 관절 null·가시성·유효성·출처를 그대로 둔다.
    expect(a.skeleton).toEqual({
      layout: 'COCO17',
      joints: [[3.4, 5.01, 1.62], null],
      jointVisible: [true, false],
      validity: ['VALID', 'UNAVAILABLE'],
      jointSource: ['observed', 'observed'],
    });
    // 미상 Z 는 0 이나 다른 값으로 채우지 않는다. 송신 측이 싣지 않은 값은 null(모름)이다.
    expect(b).toMatchObject({
      worldId: 'w-0013',
      observationState: 'PREDICTED',
      pelvis: null,
      groundAnchor: null,
      zValidity: 'UNAVAILABLE',
      headZ: null,
      surfaceSource: null,
      aliases: [],
      skeleton: null,
    });
  });

  it('분할 ID(split_from)와 inferred 접지 출처를 보존한다', () => {
    const split = adaptMessage(example('world_state.split'), 0);
    if (split.kind !== 'world') throw new Error(split.kind);
    const child = split.frame.tracks.find((t) => t.splitFrom !== null)!;
    expect(child.splitFrom).toMatch(/^w-/);
    expect(child.identityRevision).toBeGreaterThan(0);

    const inferred = adaptMessage(example('world_state.surface_inferred'), 0);
    if (inferred.kind !== 'world') throw new Error(inferred.kind);
    expect(inferred.frame.tracks[0]).toMatchObject({
      surfaceSource: 'inferred',
      contactValidity: 'UNCERTAIN',
    });
  });

  it('배치 기준: 접지 확인 → 접지점, 아니면 골반, 그다음 불확실 접지점, 모두 없으면 수평 위치만', () => {
    const [a, b] = worldExample().tracks as [TrackView, TrackView];
    expect(trackPlacement(a)).toEqual({
      basis: 'GROUND_ANCHOR',
      world: [3.41, 5.02, 0],
      groundConfirmed: true,
    });
    expect(trackPlacement({ ...a, contactValidity: 'UNCERTAIN' })).toEqual({
      basis: 'PELVIS',
      world: [3.4, 5.01, 0.92],
      groundConfirmed: false,
    });
    expect(trackPlacement({ ...a, contactValidity: 'UNCERTAIN', pelvis: null })).toMatchObject({
      basis: 'GROUND_ANCHOR_UNCERTAIN',
      groundConfirmed: false,
    });
    // 높이를 지어내지 않는다.
    expect(trackPlacement(b)).toEqual({ basis: 'XY_ONLY', xy: [6.1, 2.2], groundConfirmed: false });
  });

  it('외부에서 JSON 본문으로 받은 것과 객체로 받은 것이 같은 View Model 이 된다', () => {
    for (const file of ['world_state', 'risk_event', 'viewer_health', 'world_state.split']) {
      const raw = example(file);
      expect(adaptMessage(JSON.parse(JSON.stringify(raw)), 5)).toEqual(adaptMessage(raw, 5));
    }
  });
});

describe('이벤트·Health 값 보존', () => {
  it('risk_event 의 ID·대상·구역·등급·출처를 그대로 옮긴다', () => {
    const result = adaptMessage(example('risk_event'), 0);
    if (result.kind !== 'event') throw new Error(result.kind);
    expect(result.event).toMatchObject({
      eventId: '0192a6f0-7c1e-7b3a-9f2d-3c4b5a6d7e8f',
      eventSequence: null,
      source: 'LIVE',
      lifecycle: 'RAISED',
      severity: 'CRITICAL',
      worldIds: ['w-0012'],
      zoneId: 'z-04',
      confidenceReasons: [],
      metrics: { edge_distance_m: 0.82, height_diff_m: 2.1 },
    });
  });

  it('이벤트의 원본 world_ids 는 병합 별칭으로도 지금 Track 에 이어진다', () => {
    const result = adaptMessage(example('risk_event'), 0);
    if (result.kind !== 'event') throw new Error(result.kind);
    const [track] = worldExample().tracks as [TrackView];
    expect(eventTargetsTrack(result.event, track)).toBe(true);
    expect(eventTargetsTrack({ ...result.event, worldIds: ['w-0011'] }, track)).toBe(true);
    expect(eventTargetsTrack({ ...result.event, worldIds: ['w-0099'] }, track)).toBe(false);
  });

  it('운영자 종료 해소를 관측 해소와 구분한다', () => {
    const result = adaptMessage(example('risk_event.operator_closed'), 0);
    if (result.kind !== 'event') throw new Error(result.kind);
    expect(result.event).toMatchObject({ lifecycle: 'RESOLVED', operatorClosed: true });
  });

  it('viewer_health 의 연결·데이터 연령·Scene 불일치를 옮긴다', () => {
    const result = adaptMessage(example('viewer_health'), 0);
    if (result.kind !== 'health') throw new Error(result.kind);
    expect(result.health).toMatchObject({
      asOf: 1760342400990,
      systemHealth: 'NOMINAL',
      remoteState: 'NORMAL',
      dataAgeMs: 210,
      scene: { committedVersion: 'scene-3', liveVersion: 'scene-3', mismatch: false },
    });
  });
});

describe('거부', () => {
  it.each([
    ['객체가 아닌 값', 'hello', 'NOT_OBJECT'],
    ['null', null, 'NOT_OBJECT'],
    ['배열', [], 'NOT_OBJECT'],
    ['모르는 msg_type', { msg_type: 'mystery' }, 'UNKNOWN_MSG_TYPE'],
    ['msg_type 없음', { payload: {} }, 'UNKNOWN_MSG_TYPE'],
  ])('%s', (_, raw, reason) => {
    expect(adaptMessage(raw, 0)).toMatchObject({ kind: 'rejected', reason });
  });

  it('모르는 msg_type 은 종류를 남겨 거부한다', () => {
    expect(adaptMessage({ msg_type: 'mystery' }, 0)).toEqual({
      kind: 'rejected',
      reason: 'UNKNOWN_MSG_TYPE',
      msgType: 'mystery',
      detail: '모르는 msg_type: mystery',
    });
  });

  it('NaN·Infinity 좌표는 좌표로 받지 않는다', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const raw = example('world_state') as { payload: { tracks: { pelvis_xyz: number[] }[] } };
      raw.payload.tracks[0]!.pelvis_xyz = [1, bad, 0.9];
      expect(adaptMessage(raw, 0).kind).toBe('rejected');
    }
  });

  it('필수 필드가 빠지면 계약 오류다', () => {
    const raw = example('world_state') as { payload: Record<string, unknown> };
    delete raw.payload.tracks;
    expect(adaptMessage(raw, 0)).toMatchObject({
      kind: 'rejected',
      reason: 'SCHEMA',
      msgType: 'world_state',
    });
  });
});

describe('DEMO 구역', () => {
  it('DEMO 응답은 받고 형상 오류 구역은 이유와 함께 뺀다', () => {
    const zones = adaptDemoZones(structuredClone(DEMO_ZONES_RESPONSE), 7);
    expect(zones.status).toBe('READY');
    expect(zones.contract).toBe('DEMO_UNCONFIRMED');
    expect(zones.zones.map((z) => z.zoneId)).toEqual(['z-01', 'z-02', 'z-03']);
    expect(zones.zones[2]).toMatchObject({ min: [4.5, 7.5, 1.2], max: [6.5, 9, 2.4] });
    expect(zones.invalid).toEqual([{ zoneId: 'z-bad', reason: 'X 범위 오류(min ≥ max)' }]);
  });

  it('DEMO 표시가 없는 응답은 실제 형상을 추측해 읽지 않고 거부한다', () => {
    expect(adaptDemoZones({ zones: DEMO_ZONES_RESPONSE.zones }, 0)).toMatchObject({
      status: 'REJECTED',
      zones: [],
    });
    expect(adaptDemoZones([{ zone_id: 'z-01' }], 0).status).toBe('REJECTED');
  });

  it('좌표가 3개가 아닌 구역은 형식 오류다', () => {
    const raw = {
      contract: 'DEMO_UNCONFIRMED',
      zones: [{ zone_id: 'z-shape', name: 'x', aabb: { min_xyz: [0, 0], max_xyz: [1, 1, 1] } }],
    };
    expect(adaptDemoZones(raw, 0).invalid).toEqual([{ zoneId: 'z-shape', reason: '형식 오류' }]);
  });

  const demo = (...zones: unknown[]) => ({ contract: 'DEMO_UNCONFIRMED', zones });
  const box = (zoneId: unknown, min: unknown[], max: unknown[]) => ({
    zone_id: zoneId,
    name: 'x',
    aabb: { min_xyz: min, max_xyz: max },
  });

  it.each([
    ['0폭(X)', box('z', [1, 0, 0], [1, 1, 1]), 'X 범위 오류(min ≥ max)'],
    ['0깊이(Y)', box('z', [0, 2, 0], [1, 2, 1]), 'Y 범위 오류(min ≥ max)'],
    ['0높이(Z)', box('z', [0, 0, 1.2], [1, 1, 1.2]), 'Z 범위 오류(min ≥ max)'],
    ['뒤집힌 Z', box('z', [0, 0, 2], [1, 1, 1]), 'Z 범위 오류(min ≥ max)'],
    ['미상 높이(null)', box('z', [0, 0, null], [1, 1, 2]), '높이(Z) 미상'],
    ['미상 높이(누락 자리)', box('z', [0, 0, 0], [1, 1, undefined]), '높이(Z) 미상'],
    ['NaN', box('z', [Number.NaN, 0, 0], [1, 1, 1]), '좌표가 유한한 숫자가 아니다'],
    [
      'Infinity',
      box('z', [0, 0, 0], [1, Number.POSITIVE_INFINITY, 1]),
      '좌표가 유한한 숫자가 아니다',
    ],
    ['문자 좌표', box('z', ['0', 0, 0], [1, 1, 1]), '좌표가 유한한 숫자가 아니다'],
    ['빈 ID', box('  ', [0, 0, 0], [1, 1, 1]), '형식 오류'],
    ['aabb 없음', { zone_id: 'z', name: 'x' }, '형식 오류'],
  ])('%s 구역은 넓히거나 0 으로 채우지 않고 뺀다', (_, zone, reason) => {
    const snapshot = adaptDemoZones(demo(zone), 0);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.zones).toEqual([]);
    expect(snapshot.invalid).toEqual([
      { zoneId: (zone as { zone_id?: unknown }).zone_id ?? null, reason },
    ]);
  });

  it.each(['CRITICAL', 'HIGH', 'CAUTION', 'INFO'])('심각도 %s 는 구역에 싣는다', (severity) => {
    const [zone] = adaptDemoZones(demo({ ...box('z', [0, 0, 0], [1, 1, 1]), severity }), 0).zones;
    expect(zone?.severity).toBe(severity);
  });

  it.each([
    ['없음', undefined],
    ['모르는 값', 'WARN'],
    ['글자가 아님', 3],
  ])('심각도가 %s 이면 구역은 받고 심각도만 비운다', (_, severity) => {
    const snapshot = adaptDemoZones(demo({ ...box('z', [0, 0, 0], [1, 1, 1]), severity }), 0);
    expect(snapshot.zones).toHaveLength(1);
    expect(snapshot.zones[0]).not.toHaveProperty('severity');
    expect(snapshot.invalid).toEqual([]);
  });

  it('객체가 아닌 항목은 ID 없이 형식 오류로 뺀다', () => {
    expect(adaptDemoZones(demo(null, 3), 0).invalid).toEqual([
      { zoneId: null, reason: '형식 오류' },
      { zoneId: null, reason: '형식 오류' },
    ]);
  });

  it('같은 zone_id 가 둘 이상이면 어느 쪽도 그리지 않고 나머지는 받는다', () => {
    const snapshot = adaptDemoZones(
      demo(
        box('z-dup', [0, 0, 0], [1, 1, 1]),
        box('z-ok', [2, 2, 0], [3, 3, 1]),
        box('z-dup', [5, 5, 0], [6, 6, 1]),
      ),
      0,
    );
    expect(snapshot.zones.map((z) => z.zoneId)).toEqual(['z-ok']);
    expect(snapshot.invalid).toEqual([
      { zoneId: 'z-dup', reason: 'zone_id 중복' },
      { zoneId: 'z-dup', reason: 'zone_id 중복' },
    ]);
  });
});

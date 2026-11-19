import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  AVATAR_FORGET_MS,
  createSpatialDataStore,
  type SpatialDataStore,
} from '@/features/viewer3d/data/spatialData.store';
import { SpatialDataContext } from '@/features/viewer3d/data/SpatialDataProvider';
import type { TrackView, WorldFrame } from '@/features/viewer3d/data/spatialFrame';
import {
  SYNTHETIC_MHR,
  SYNTHETIC_MHR_DENSE,
  walkRotations,
} from '@/features/viewer3d/dev-harness/avatarFixture';
import {
  AVATAR_LATE,
  AVATAR_STALL,
  avatarCrowdFrame,
  avatarCrowdSize,
  avatarFrameMessage,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { avatarFrameOf, type AvatarPoseView } from '@/features/viewer3d/people/avatarFrame';
import {
  AvatarMeshContext,
  clearAvatarMeshCache,
  instantiateAvatarMesh,
  jointParentsSha256,
  readAvatarMesh,
  sha256Of,
} from '@/features/viewer3d/people/avatarMesh';
import {
  AVATAR_IDENTITY_HOLD_MS,
  AVATAR_LATE_MS,
  AVATAR_STALL_MS,
  avatarMeshStatus,
  type AvatarAssetState,
} from '@/features/viewer3d/people/avatarMeshPolicy';
import { applyPose, axisAngleQuaternion, PosePlayer } from '@/features/viewer3d/people/avatarPose';
import { PersonLayer } from '@/features/viewer3d/people/PersonLayer';
import { createViewerStore, type ViewerStore } from '@/features/viewer3d/viewer3d.store';
import { ViewerStoreContext } from '@/features/viewer3d/ViewerStoreContext';
import {
  threeToWorld,
  toThreePoint,
  worldPoint,
  worldToThree,
} from '@/features/viewer3d/worldCoordinates';
import { advance, createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import type { AvatarFrameMessage } from '@simai/contracts';
import { act, useEffect } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -65 EXP-02 아바타 메시: 계약 어댑터 · 사람별 최신 포즈 · 되돌아가기 5조건 · 자산 확인 · 회전 적용·pelvis 정렬 · 재생 보간 · 장면 연결.
// 자산은 합성 127관절 리그(fixtures/synthetic-mhr.glb)다. 실제 MHR 자산·실시간 스트림 시험은 아니다.

const T0 = 1_760_342_400_000;
// 앱 Vite 설정(assetsInclude)을 바꾸지 않으려고 fixture 바이트는 Node fs 로 읽는다(앱 tsconfig 에 Node 타입이 없다).
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
  readFileSync(path: string): Uint8Array;
};
// vitest 는 앱 폴더(front/apps/admin)에서 돈다.
const cwd = (Reflect.get(globalThis, 'process') as { cwd(): string }).cwd();
const FIXTURE = fs.readFileSync(
  cwd + '/src/features/viewer3d/dev-harness/fixtures/synthetic-mhr.glb',
);
// Node Buffer 는 공유 풀의 일부라 .buffer 를 바로 쓰지 않고 복사한다.
const bytes = () => new Uint8Array(FIXTURE).buffer;
const DENSE = fs.readFileSync(
  cwd + '/src/features/viewer3d/dev-harness/fixtures/synthetic-mhr-dense.glb',
);
const clone = <T,>(v: T): T => structuredClone(v);
// 계약 정본 예시(contracts/examples/avatar_frame.json, 사람 2명).
const [avatarFrameExample] = Object.values(
  import.meta.glob('../../../../../../../contracts/examples/avatar_frame.json', {
    eager: true,
    import: 'default',
  }),
);
const example = () => clone(avatarFrameExample) as AvatarFrameMessage;

function frameOf(tick: number) {
  const raw = avatarFrameMessage(tick, T0);
  const result = adaptMessage(raw, T0 + tick * 100);
  if (result.kind !== 'avatar') throw new Error(result.kind);
  return result.frame;
}
const worldAt = (tick: number) => {
  const result = adaptMessage(scenarioWorld('avatar-mesh', tick, T0), T0 + tick * 100);
  if (result.kind !== 'world') throw new Error(result.kind);
  return result.frame;
};

describe('avatar_frame 어댑터(스키마 밖 규칙)', () => {
  it('같은 world_id 가 둘이면 그 사람을 모두 뺀다', () => {
    const message = example();
    message.payload.avatars[1]!.world_id = message.payload.avatars[0]!.world_id;
    const view = avatarFrameOf(message, 0);
    expect(view.avatars).toEqual([]);
    expect(view.dropped.map((d) => d.reason)).toEqual(['world_id 중복', 'world_id 중복']);
  });

  it('회전각이 π 를 넘거나 관절 0 이 돌아 있으면 그 사람만 뺀다', () => {
    const message = example();
    message.payload.avatars[0]!.pose.joint_rotations[5] = [3, 3, 0];
    message.payload.avatars[1]!.pose.joint_rotations[0] = [0.1, 0, 0];
    const view = avatarFrameOf(message, 0);
    expect(view.avatars).toEqual([]);
    expect(view.dropped.map((d) => d.reason)).toEqual([
      '관절 회전각 > π',
      '관절 0 회전이 0 이 아님',
    ]);
  });

  it('자산 ID 차수가 포즈보다 크면 자산을 쓰지 않는다(캡슐)', () => {
    const message = example();
    message.payload.avatars[1]!.asset!.identity_revision = 5;
    const view = avatarFrameOf(message, 0);
    expect(view.avatars[1]!.asset).toBeNull();
    expect(view.avatars[1]!.assetRejected).toBe('자산 ID 차수가 포즈보다 큼');
  });
});

describe('데이터 Store 의 사람별 포즈', () => {
  let store: SpatialDataStore;
  beforeEach(() => {
    store = createSpatialDataStore();
  });

  it('촬영 시각이 늦은 포즈만 바꾸고, World(Tier 0)는 건드리지 않는다', () => {
    store.getState().ingest(scenarioWorld('avatar-mesh', 10, T0), 1);
    const world = store.getState().world;
    const events = store.getState().events;
    expect(store.getState().ingest(avatarFrameMessage(10, T0), 2)).toBe('avatar');
    const older = {
      ...(avatarFrameMessage(8, T0) as object),
      msg_id: '5e000008-0000-4000-8000-0000000000ff',
    };
    expect(store.getState().ingest(older, 3)).toBe('out_of_order');
    expect(store.getState().avatars.get('w-0001')!.captureTimeMs).toBe(T0 + 1000 - 300);
    expect(store.getState().world).toBe(world);
    expect(store.getState().events).toBe(events);
    expect(store.getState().counts).toMatchObject({ world: 1, avatar: 1, outOfOrder: 1 });
  });

  it('30초 넘게 새 포즈가 없는 사람은 지우고, Source 를 바꾸면 모두 비운다', () => {
    store.getState().ingest(avatarFrameMessage(0, T0), 0);
    const partial = clone(avatarFrameMessage(2, T0)) as unknown as AvatarFrameMessage;
    const [w1] = partial.payload.avatars.filter((a) => a.world_id === 'w-0001');
    partial.payload.avatars = [w1!];
    store.getState().ingest(partial, AVATAR_FORGET_MS + 1);
    expect([...store.getState().avatars.keys()]).toEqual(['w-0001']);
    store.getState().reset('other');
    expect(store.getState().avatars.size).toBe(0);
  });
});

describe('되돌아가기 판정', () => {
  const world = worldAt(20);
  const track = world.tracks.find((t) => t.worldId === 'w-0001')!;
  const pose = frameOf(20).avatars.find((a) => a.worldId === 'w-0001')!;
  const now = pose.receivedAt + 100;
  const ready: AvatarAssetState = { status: 'READY' };
  const status = (over: {
    track?: Partial<TrackView>;
    world?: Partial<WorldFrame>;
    avatar?: Partial<AvatarPoseView> | null;
    asset?: AvatarAssetState;
    now?: number;
    enabled?: boolean;
  }) =>
    avatarMeshStatus({
      enabled: over.enabled ?? true,
      track: { ...track, ...over.track },
      world: { ...world, ...over.world },
      avatar: over.avatar === null ? undefined : { ...pose, ...over.avatar },
      asset: over.asset ?? ready,
      now: over.now ?? now,
    });

  it('조건이 모두 맞으면 메시로 그리고 HMR 지연을 상태에 담는다', () => {
    expect(status({})).toMatchObject({ use: true, fallback: null, hmrLagMs: 300, poseAgeMs: 100 });
  });

  it.each([
    ['OFF', { enabled: false }],
    ['NO_POSE', { avatar: null }],
    ['IDENTITY', { track: { identityConfidence: 'IDENTITY_UNCERTAIN' as const } }],
    ['IDENTITY', { avatar: { identityRevision: 7 } }],
    ['CALIBRATION', { avatar: { calibrationVersion: 'cal-old' } }],
    ['STALLED', { now: pose.receivedAt + AVATAR_STALL_MS + 1 }],
    ['HMR_LATE', { avatar: { captureTimeMs: world.tLatestGlobal - AVATAR_LATE_MS - 1 } }],
    ['NO_ASSET', { avatar: { asset: null } }],
    ['JOINT_MISMATCH', { avatar: { jointRotations: pose.jointRotations.slice(0, 126) } }],
    ['NO_PELVIS', { track: { pelvis: null } }],
    ['ASSET_LOADING', { asset: { status: 'LOADING' } as AvatarAssetState }],
    ['ASSET_ERROR', { asset: { status: 'ERROR', reason: 'sha256 불일치' } as AvatarAssetState }],
  ])('%s 면 캡슐로 되돌아간다', (reason, over) => {
    expect(status(over as Parameters<typeof status>[0])).toMatchObject({
      use: false,
      fallback: reason,
    });
  });

  it('같은 차수의 짧은 IDENTITY_UNCERTAIN(1.5 s 안)은 마지막 자세로 메시를 유지하고, 길어지거나 차수가 다르면 캡슐(-661)', () => {
    const uncertain = { identityConfidence: 'IDENTITY_UNCERTAIN' as const };
    const since = (startedAt: number) => ({
      identityUncertainSince: new Map([[track.worldId, startedAt]]),
    });
    const held = status({
      track: uncertain,
      world: since(world.tLatestGlobal - AVATAR_IDENTITY_HOLD_MS),
    });
    expect(held).toMatchObject({ use: true, fallback: null });
    // 그동안 새 포즈가 없어도 끊김·늦음 기준이 유예만큼 늘어난다.
    expect(
      status({
        track: uncertain,
        world: since(world.tLatestGlobal - 500),
        now: pose.receivedAt + AVATAR_STALL_MS + 400,
      }).use,
    ).toBe(true);
    expect(
      status({ track: uncertain, world: since(world.tLatestGlobal - AVATAR_IDENTITY_HOLD_MS - 1) }),
    ).toMatchObject({ use: false, fallback: 'IDENTITY' });
    expect(
      status({
        track: uncertain,
        world: since(world.tLatestGlobal),
        avatar: { identityRevision: track.identityRevision + 1 },
      }),
    ).toMatchObject({ use: false, fallback: 'IDENTITY' });
    // 차수가 같아도 확실한 트랙이면 끊김 기준은 그대로다.
    expect(status({ now: pose.receivedAt + AVATAR_STALL_MS + 400 }).fallback).toBe('STALLED');
  });

  it('순수 병합 직후 병합 전 차수의 포즈는 유예 안에서 메시를 유지하고, 분할 등은 캡슐(-743)', () => {
    const merged = {
      track: { identityRevision: pose.identityRevision + 1 },
      world: { pureMergeBase: new Map([[track.worldId, pose.identityRevision]]) },
    };
    expect(status(merged)).toMatchObject({ use: true, fallback: null });
    // 새 포즈가 오지 않아도 끊김 기준이 유예만큼 늘어나고, 넘으면 캡슐이다.
    expect(status({ ...merged, now: pose.receivedAt + AVATAR_STALL_MS + 400 }).use).toBe(true);
    expect(
      status({ ...merged, now: pose.receivedAt + AVATAR_STALL_MS + AVATAR_IDENTITY_HOLD_MS + 1 })
        .fallback,
    ).toBe('STALLED');
    // 병합 직후 불확실(차수가 바뀌어 시작 시각이 병합 시각)도 유예 안이면 유지한다.
    expect(
      status({
        track: { ...merged.track, identityConfidence: 'IDENTITY_UNCERTAIN' },
        world: {
          ...merged.world,
          identityUncertainSince: new Map([[track.worldId, world.tLatestGlobal - 300]]),
        },
      }).use,
    ).toBe(true);
    // 사슬 시작 차수가 없거나(분할·그 밖의 상승) 포즈가 사슬 시작보다 오래되면 캡슐이다.
    expect(status({ track: merged.track })).toMatchObject({ use: false, fallback: 'IDENTITY' });
    expect(
      status({
        track: merged.track,
        world: { pureMergeBase: new Map([[track.worldId, pose.identityRevision + 1]]) },
      }),
    ).toMatchObject({ use: false, fallback: 'IDENTITY' });
  });

  it('경계값(끊김 1000 ms·늦음 1000 ms)은 아직 메시다', () => {
    expect(status({ now: pose.receivedAt + AVATAR_STALL_MS }).use).toBe(true);
    expect(status({ avatar: { captureTimeMs: world.tLatestGlobal - AVATAR_LATE_MS } }).use).toBe(
      true,
    );
  });

  it('시나리오의 끊김·늦음 구간이 각각 STALLED·HMR_LATE 가 된다', () => {
    const stallTick = AVATAR_STALL[0] + 10;
    const lastPose = frameOf(AVATAR_STALL[0] - 2).avatars.find((a) => a.worldId === 'w-0002')!;
    expect(frameOf(stallTick).avatars.some((a) => a.worldId === 'w-0002')).toBe(false);
    const stalled = avatarMeshStatus({
      enabled: true,
      track: worldAt(stallTick).tracks.find((t) => t.worldId === 'w-0002')!,
      world: worldAt(stallTick),
      avatar: lastPose,
      asset: ready,
      now: T0 + stallTick * 100,
    });
    expect(stalled.fallback).toBe('STALLED');
    const lateTick = AVATAR_LATE[0];
    const late = avatarMeshStatus({
      enabled: true,
      track: worldAt(lateTick).tracks.find((t) => t.worldId === 'w-0001')!,
      world: worldAt(lateTick),
      avatar: frameOf(lateTick).avatars.find((a) => a.worldId === 'w-0001'),
      asset: ready,
      now: T0 + lateTick * 100,
    });
    expect(late).toMatchObject({ fallback: 'HMR_LATE', hmrLagMs: 1300 });
  });
});

describe('자산 확인(합성 127관절 GLB)', () => {
  const asset = () => frameOf(0).avatars[0]!.asset!;

  it('fixture 의 sha256·부모 해시가 시나리오 상수와 같다', async () => {
    expect(await sha256Of(bytes())).toBe(SYNTHETIC_MHR.meshSha256);
    const mesh = await readAvatarMesh(bytes(), asset());
    expect(mesh.jointCount).toBe(127);
  });

  it('dense fixture(실제 MHR 크기)도 같은 리그이고 sha256 이 상수와 같다', async () => {
    const data = new Uint8Array(DENSE).buffer;
    expect(await sha256Of(data)).toBe(SYNTHETIC_MHR_DENSE.meshSha256);
    const mesh = await readAvatarMesh(data, {
      ...asset(),
      meshSha256: SYNTHETIC_MHR_DENSE.meshSha256,
    });
    let vertices = 0;
    mesh.scene.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && g) vertices += g.attributes.position!.count;
    });
    expect([mesh.jointCount, vertices]).toEqual([127, 21168]);
  });

  it('avatar-crowd 시나리오는 1·5·10명의 포즈를 계약대로 싣는다', () => {
    for (const key of ['avatar-crowd-1', 'avatar-crowd-5', 'avatar-crowd-10'] as const) {
      const size = avatarCrowdSize(key)!;
      const result = adaptMessage(avatarCrowdFrame(key, size, 20, T0), T0);
      if (result.kind !== 'avatar') throw new Error(result.kind);
      expect(result.frame.avatars).toHaveLength(size);
      expect(new Set(result.frame.avatars.map((a) => a.asset?.meshSha256))).toEqual(
        new Set([SYNTHETIC_MHR_DENSE.meshSha256]),
      );
      const world = adaptMessage(scenarioWorld(key, 20, T0), T0);
      if (world.kind !== 'world') throw new Error(world.kind);
      expect(world.frame.tracks.map((t) => t.worldId)).toEqual(
        result.frame.avatars.map((a) => a.worldId),
      );
    }
  });

  it('부모 배열 해시는 -88 rig.py 와 같은 식이다(공백 없는 JSON)', async () => {
    // rig.py joint_parents_sha256([-1, 0, 1, 1]) 를 Python 으로 잰 값.
    expect(await jointParentsSha256([-1, 0, 1, 1])).toBe(
      'sha256:a60ff9783f54ad3425259c0986f50279b2ea2dcad4ecca8bdf0137fac9fda017',
    );
  });

  it.each([
    ['sha256 불일치', { meshSha256: 'sha256:' + '0'.repeat(64) }],
    ['관절 수 불일치', { jointCount: 126 }],
    ['관절 부모 해시 불일치', { jointParentsSha256: 'sha256:' + '1'.repeat(64) }],
    ['pelvis 관절 범위 밖', { pelvisJointIndex: 127 }],
  ])('%s 면 거부한다', async (reason, over) => {
    await expect(readAvatarMesh(bytes(), { ...asset(), ...over })).rejects.toThrow(reason);
  });
});

describe('회전 적용과 pelvis 정렬', () => {
  it('pelvis 뼈가 Tier 0 pelvis 에 오고, 서 있으며, root_rotation 의 방향을 본다', async () => {
    const mesh = await readAvatarMesh(bytes(), frameOf(0).avatars[0]!.asset!);
    const rig = instantiateAvatarMesh(mesh);
    const group = new THREE.Group();
    group.add(rig.root);
    const player = new PosePlayer();
    // 선 자세(관절 회전 0)에 시나리오의 몸 방향(root_rotation)만 쓴다.
    const walking = frameOf(20).avatars.find((a) => a.worldId === 'w-0001')!;
    const pose = { ...walking, jointRotations: walkRotations(0, 0) };
    player.push(pose);
    const pelvis = worldToThree(worldPoint(3.2, 6.1, 0.95));
    applyPose(rig, group, player.frame(pose.receivedAt + 1000, 250)!, new THREE.Vector3(...pelvis));
    group.updateMatrixWorld(true);
    const at = (i: number) => rig.bones[i]!.getWorldPosition(new THREE.Vector3());
    const p = at(1);
    expect(p.distanceTo(new THREE.Vector3(...pelvis))).toBeLessThan(1e-6);
    // 머리(6)는 pelvis 위(Three +Y), 발끝(18·22)은 바닥 가까이(합성 리그 pelvis 높이 0.924 m).
    expect(at(6).y - p.y).toBeGreaterThan(0.4);
    expect(Math.abs(at(18).y - (0.95 - 0.924 + 0.004))).toBeLessThan(1e-3);
    // 발끝 방향 = root_rotation 이 뜻하는 World 진행 방향.
    const toe = threeToWorld(
      toThreePoint(at(18).clone().add(at(22)).multiplyScalar(0.5).sub(p).toArray())!,
    );
    const heading = Math.atan2(toe[1], toe[0]);
    const q = axisAngleQuaternion(pose.rootRotation);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(Math.abs(Math.atan2(forward.y, forward.x) - heading)).toBeLessThan(0.05);
    rig.dispose();
  });
});

describe('재생 버퍼', () => {
  const at = (capture: number, received: number, x: number, revision = 0): AvatarPoseView => ({
    ...frameOf(0).avatars[0]!,
    identityRevision: revision,
    captureTimeMs: capture,
    receivedAt: received,
    rootRotation: [x, 0, 0],
  });

  it('지연 250 ms 뒤의 두 표본 사이를 보간하고, 새 표본이 없으면 마지막을 유지한다(외삽 없음)', () => {
    const player = new PosePlayer();
    player.push(at(1000, 1300, 0));
    player.push(at(1200, 1500, 0.4));
    // 시계 차이 300 ms. now 1650 → 재생 시각 1650 − 300 − 250 = 1100(두 표본 가운데).
    const mid = player.frame(1650, 250)!;
    expect(mid.t).toBeCloseTo(0.5);
    const hold = player.frame(5000, 250)!;
    expect([hold.a.captureTimeMs, hold.b.captureTimeMs, hold.t]).toEqual([1200, 1200, 0]);
  });

  it('늦게 온 표본은 시각 순서로 끼우고, ID 교정 차수가 바뀌면 이전 표본을 버린다', () => {
    const player = new PosePlayer();
    player.push(at(1200, 1500, 0));
    player.push(at(1000, 1600, 0));
    expect(player.frame(1300, 0)!.a.captureTimeMs).toBe(1000);
    player.push(at(1400, 1700, 0, 1));
    expect(player.size).toBe(1);
  });
});

// ---- 장면 연결(가짜 renderer) ----

extend(THREE as unknown as Parameters<typeof extend>[0]);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    render: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    dispose: () => {},
    forceContextLoss: () => {},
    domElement: canvas,
    shadowMap: { enabled: false, type: 0, needsUpdate: false },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAnimationLoop: () => {},
    },
    renderLists: { dispose: () => {} },
    outputColorSpace: '',
    toneMapping: 0,
  };
}

describe('PersonLayer 메시 연결', () => {
  let scene: THREE.Scene | null = null;
  function SceneProbe() {
    const current = useThree((s) => s.scene);
    useEffect(() => {
      scene = current;
    }, [current]);
    return null;
  }
  let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
  let viewer: ViewerStore;
  let data: SpatialDataStore;
  let clock = T0;
  const fetcher = vi.fn(async (url: string) => {
    if (!url.includes('/versions/0/')) throw new Error('HTTP 404');
    return bytes();
  });

  async function mount(enabled = true) {
    const canvas = document.createElement('canvas');
    root ??= createRoot(canvas);
    await root.configure({
      gl: fakeRenderer(canvas) as never,
      size: { width: 800, height: 600, top: 0, left: 0 },
      frameloop: 'never',
    });
    await act(async () =>
      root!.render(
        <ViewerStoreContext value={viewer}>
          <SpatialDataContext value={data}>
            <AvatarMeshContext value={{ enabled, fetch: fetcher }}>
              <SceneProbe />
              <PersonLayer />
            </AvatarMeshContext>
          </SpatialDataContext>
        </ViewerStoreContext>,
      ),
    );
  }
  async function tick(n: number) {
    clock = T0 + n * 100 + 50;
    await act(async () => {
      data.getState().ingest(scenarioWorld('avatar-mesh', n, T0), clock);
      const frame = avatarFrameMessage(n, T0);
      if (frame && n % 2 === 0) data.getState().ingest(frame, clock);
    });
    for (let i = 0; i < 3; i++) await act(async () => advance(performance.now() + i * 16));
    // 자산 읽기(비동기)와 상태 반영을 기다린다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    for (let i = 0; i < 2; i++) await act(async () => advance(performance.now() + i * 16));
  }
  const find = (name: string) => {
    const found: THREE.Object3D[] = [];
    scene!.traverse((o) => {
      if (o.name === name) found.push(o);
    });
    return found;
  };
  const meshOf = (id: string) =>
    scene!.getObjectByName('person:' + id)?.getObjectByName('person-mesh') ?? null;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    viewer = createViewerStore();
    viewer.getState().markReady();
    data = createSpatialDataStore();
    fetcher.mockClear();
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    clearAvatarMeshCache();
    vi.restoreAllMocks();
  });

  async function settle(n: number) {
    for (let i = 0; i <= n; i++) await tick(i);
    // 자산 Promise 가 여러 단계라 한 번 더 돌린다.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await tick(n + 1);
  }

  it('포즈·자산이 맞는 사람은 메시, 자산 404 인 사람은 캡슐이고 pelvis 는 Tier 0 위치다', async () => {
    await mount();
    await settle(20);
    expect(meshOf('w-0001')).not.toBeNull();
    expect(meshOf('w-0002')).not.toBeNull();
    expect(meshOf('w-0003')).toBeNull();
    const mesh = meshOf('w-0001')!;
    expect(mesh.visible).toBe(true);
    const bone = mesh.getObjectByName('root')!;
    const p = bone.getWorldPosition(new THREE.Vector3());
    const track = data.getState().world!.tracks.find((t) => t.worldId === 'w-0001')!;
    expect(p.distanceTo(new THREE.Vector3(...worldToThree(track.pelvis!)))).toBeLessThan(1e-6);
    // 같은 사람의 캡슐·골격은 그리지 않는다.
    expect(
      scene!.getObjectByName('person-avatar:w-0001')!.getObjectByName('person-skeleton'),
    ).toBeUndefined();
    // 자산은 사람마다 한 번만 받는다(같은 sha 는 캐시).
    expect(fetcher.mock.calls.filter(([u]) => u.includes('/versions/0/')).length).toBe(1);
    expect(find('person-mesh')).toHaveLength(2);
  });

  it('포즈가 끊긴 사람은 1.0초 뒤 캡슐로 돌아가고 다시 오면 메시로 돌아온다', async () => {
    await mount();
    await settle(AVATAR_STALL[0] + 10);
    expect(meshOf('w-0002')).toBeNull();
    expect(meshOf('w-0001')).not.toBeNull();
    for (let n = AVATAR_STALL[0] + 12; n <= AVATAR_STALL[1] + 2; n++) await tick(n);
    expect(meshOf('w-0002')).not.toBeNull();
  });

  it("avatarMesh 'off' 면 포즈가 와도 메시를 그리지 않는다", async () => {
    await mount(false);
    await settle(10);
    expect(find('person-mesh')).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

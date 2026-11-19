import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { DEMO_WORK_SURFACES, DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import {
  applyEditOperation,
  applyEditOperations,
  objectFieldOperations,
  WORK_SURFACE_OBB_POLICY,
  type WorldObb,
} from '@/features/viewer3d/editing/editGeometry';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import type { ViewerObjectEditResult } from '@/features/viewer3d/editing/editTypes';
import {
  adaptWorkSurfaces,
  obbWorkSurface,
  surfaceCorners,
  surfaceTopEdge,
  workSurfaceItem,
  workSurfaceObb,
  type WorkSurfaceGeometry,
} from '@/features/viewer3d/surfaces/workSurfaceGeometry';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { worldToThree } from '@/features/viewer3d/worldCoordinates';
import { Object3D, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// -188 등록 작업면 OBB: 계약 형식 검사, World 꼭짓점·윗면 가장자리, 공통 엔진 정책, 편집 세션(미리보기·취소·결과·stale).

const T0 = 1_760_342_400_000;
// 손으로 확인하기 쉬운 90° 회전 작업면. 지역 (u, v) → World (−v, u) + 중심.
const TURNED: WorkSurfaceGeometry = {
  centerXy: [2, 3],
  sizeXy: [2, 1],
  yawRad: Math.PI / 2,
  topHeightM: 0.5,
};
const near = (actual: readonly number[], expected: readonly number[], digits = 9) =>
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, digits));

describe('작업면 묶음 검사(계약 work_surface 형식)', () => {
  it('DEMO 묶음: 유효 3개만 받고 크기 0·바닥 ID 는 이유와 함께 뺀다', () => {
    const snapshot = adaptWorkSurfaces(structuredClone(DEMO_WORK_SURFACES), T0);
    expect(snapshot.status).toBe('READY');
    expect(snapshot.contract).toBe('OPERATIONAL_GEOMETRY_UNCONFIRMED');
    expect(snapshot.geometryVersion).toBe('demo-og-1');
    expect(snapshot.surfaces.map((s) => s.surfaceId)).toEqual(['podium-1', 'desk-1', 'desk-2']);
    expect(snapshot.invalid).toEqual([
      { surfaceId: 'desk-bad', reason: 'size_xy 는 양수 2개여야 한다' },
      { surfaceId: 'floor', reason: '바닥 ID(floor)와 겹친다' },
    ]);
    expect(snapshot.surfaces[0]).toMatchObject({
      surfaceId: 'podium-1',
      topHeightM: 0.4,
      centerXy: [7.6, 7.4],
      sizeXy: [2.4, 1.1],
      yawRad: 0,
      topHeightSigmaM: null,
    });
  });

  it('AI(risk.work_surface) 와 같은 항목을 받고 뺀다: 중복은 앞 유효 항목, sigma 검사, 범위 밖 yaw 는 같은 방향으로 감는다', () => {
    const item = (patch: Record<string, unknown>) => ({
      surface_id: 's',
      top_height_m: 0.4,
      center_xy: [1, 1],
      size_xy: [1, 1],
      ...patch,
    });
    const snapshot = adaptWorkSurfaces(
      {
        work_surfaces: [
          item({ surface_id: 'twin', top_height_m: 0 }),
          item({ surface_id: 'twin' }),
          item({ surface_id: 'twin', center_xy: [5, 5] }),
          item({ surface_id: 'sig', top_height_sigma_m: 0.05, name: '단상' }),
          item({ surface_id: 'neg-sig', top_height_sigma_m: -0.01 }),
          item({ surface_id: 'big-yaw', yaw_rad: 7 }),
          item({ surface_id: ' ' }),
          item({ surface_id: '' }),
        ],
      },
      T0,
    );
    // 앞의 twin 은 형식 오류라 빠지고, 두 번째 twin 이 쓰이며 세 번째는 겹친다(AI seen 규칙).
    expect(snapshot.surfaces.map((s) => s.surfaceId)).toEqual(['twin', 'sig', 'big-yaw', ' ']);
    expect(snapshot.surfaces[0]!.centerXy).toEqual([1, 1]);
    expect(snapshot.invalid).toEqual([
      { surfaceId: 'twin', reason: 'top_height_m 은 0 보다 큰 유한수여야 한다' },
      { surfaceId: 'twin', reason: 'surface_id 가 겹친다(앞 항목 사용)' },
      { surfaceId: 'neg-sig', reason: 'top_height_sigma_m 은 0 이상 유한수여야 한다' },
      { surfaceId: '', reason: 'surface_id 가 비었다' },
    ]);
    const sig = snapshot.surfaces[1]!;
    expect(sig.topHeightSigmaM).toBe(0.05);
    expect(sig.source).toMatchObject({ name: '단상', top_height_sigma_m: 0.05 });
    // AI 는 7 rad 를 그대로 cos·sin 에 넣는다. 화면은 같은 방향의 [-π, π] 값이다.
    const yaw = snapshot.surfaces[2]!.yawRad;
    expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(yaw)).toBeCloseTo(Math.cos(7), 12);
    expect(Math.sin(yaw)).toBeCloseTo(Math.sin(7), 12);
  });

  it('묶음 모양: work_surfaces 가 없으면 0개, 배열이 아니거나 묶음이 객체가 아니면 거부', () => {
    expect(adaptWorkSurfaces({ version: 'g1', static_objects: [] }, T0)).toMatchObject({
      status: 'READY',
      geometryVersion: 'g1',
      surfaces: [],
    });
    expect(adaptWorkSurfaces({ work_surfaces: {} }, T0)).toMatchObject({ status: 'REJECTED' });
    expect(adaptWorkSurfaces([], T0)).toMatchObject({ status: 'REJECTED' });
    expect(adaptWorkSurfaces(null, T0)).toMatchObject({ status: 'REJECTED' });
  });

  it('결과 항목은 계약 snake_case 로 바꾸고 원본의 다른 키(sigma·name)를 그대로 둔다', () => {
    const source = Object.freeze({
      surface_id: 'p',
      top_height_m: 0.4,
      center_xy: [1, 1],
      size_xy: [1, 1],
      top_height_sigma_m: 0.05,
      name: '단상',
    });
    expect(workSurfaceItem('p', TURNED, source)).toEqual({
      surface_id: 'p',
      top_height_m: 0.5,
      center_xy: [2, 3],
      size_xy: [2, 1],
      yaw_rad: Math.PI / 2,
      top_height_sigma_m: 0.05,
      name: '단상',
    });
    expect(Object.keys(workSurfaceItem('n', TURNED)).sort()).toEqual([
      'center_xy',
      'size_xy',
      'surface_id',
      'top_height_m',
      'yaw_rad',
    ]);
  });

  it('잘못된 형상은 고쳐 받지 않고 뺀다: 상판 0·비유한 좌표·비유한 yaw', () => {
    const item = (patch: Record<string, unknown>) => ({
      surface_id: 's',
      top_height_m: 0.4,
      center_xy: [1, 1],
      size_xy: [1, 1],
      ...patch,
    });
    const snapshot = adaptWorkSurfaces(
      {
        work_surfaces: [
          item({ surface_id: 'inf-yaw', yaw_rad: Number.POSITIVE_INFINITY }),
          item({ surface_id: 'flat', top_height_m: 0 }),
          item({ surface_id: 'nan', center_xy: [1, Number.NaN] }),
          item({ surface_id: 'bool', top_height_m: true }),
          item({ surface_id: 'no-yaw' }),
          'not-an-object',
        ],
      },
      T0,
    );
    expect(snapshot.surfaces.map((s) => [s.surfaceId, s.yawRad])).toEqual([['no-yaw', 0]]);
    expect(snapshot.invalid.map((i) => i.surfaceId)).toEqual([
      'inf-yaw',
      'flat',
      'nan',
      'bool',
      null,
    ]);
  });
});

describe('작업면 World 형상', () => {
  it('윗면 가장자리 꼭짓점은 yaw 를 반영하고 AI footprint 와 같은 반시계 순서다', () => {
    const top = surfaceTopEdge(TURNED);
    near(top[0]!, [2.5, 2, 0.5]);
    near(top[1]!, [2.5, 4, 0.5]);
    near(top[2]!, [1.5, 4, 0.5]);
    near(top[3]!, [1.5, 2, 0.5]);
    // 변 길이 = 크기, 높이 = 상판, 바닥 둘레는 Z=0.
    const length = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
    expect(length(top[0]!, top[1]!)).toBeCloseTo(2, 9);
    expect(length(top[1]!, top[2]!)).toBeCloseTo(1, 9);
    expect(surfaceCorners(TURNED, 0).every((p) => p[2] === 0)).toBe(true);
  });

  it('작업면 → OBB → 작업면 왕복이 같고, OBB 는 바닥(Z=0)부터 상판까지다', () => {
    const obb = workSurfaceObb(TURNED);
    expect(obb.center).toEqual([2, 3, 0.25]);
    expect(obb.size).toEqual([2, 1, 0.5]);
    expect(obb.center[2] - obb.size[2] / 2).toBe(0);
    expect(obbWorkSurface(obb)).toEqual(TURNED);
  });

  it('Three 배치(중심 + rotation.y = yaw)의 상자 모서리가 World 꼭짓점의 worldToThree 와 같다', () => {
    const obb = workSurfaceObb(TURNED);
    const node = new Object3D();
    node.position.fromArray(worldToThree(obb.center));
    node.rotation.y = obb.yaw;
    node.updateMatrixWorld();
    const [hx, hy, hz] = [obb.size[0] / 2, obb.size[1] / 2, obb.size[2] / 2];
    // Three 로컬: X = 작업면 X', Y = 높이, −Z = 작업면 Y'.
    const local: [number, number][] = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ];
    surfaceTopEdge(TURNED).forEach((corner, i) => {
      const [u, v] = local[i]!;
      const placed = node.localToWorld(new Vector3(u, hz, -v)).toArray();
      near(placed, worldToThree(corner), 9);
    });
  });
});

describe('작업면 OBB 정책(공통 엔진)', () => {
  const obb = workSurfaceObb(TURNED);
  const run = (op: Parameters<typeof applyEditOperation>[1]) =>
    applyEditOperation({ kind: 'obb', ...obb }, op, WORK_SURFACE_OBB_POLICY);
  const shape = (out: ReturnType<typeof run>): WorldObb => {
    if (!out.ok || out.shape.kind !== 'obb') throw new Error('OBB 결과가 아니다');
    return out.shape;
  };

  it('기울임(pitch·roll)·Z 이동·하단 면은 NOT_EDITABLE 로 거부한다', () => {
    expect(run({ type: 'rotate', axis: 'pitch', radians: 0.1 })).toMatchObject({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
    expect(run({ type: 'rotate', axis: 'roll', radians: 0.1 })).toMatchObject({
      reason: 'NOT_EDITABLE',
    });
    expect(run({ type: 'translate', delta: [0, 0, 0.2] })).toMatchObject({
      reason: 'NOT_EDITABLE',
    });
    expect(run({ type: 'face', face: 'z-', delta: 0.1 })).toMatchObject({
      reason: 'NOT_EDITABLE',
    });
  });

  it("X'+ 면은 지역 축으로만 움직이고 반대 면(X'−) 꼭짓점은 그대로다", () => {
    const moved = obbWorkSurface(shape(run({ type: 'face', face: 'x+', delta: 0.4 })));
    expect(moved.sizeXy[0]).toBeCloseTo(2.4, 9);
    near(moved.centerXy, [2, 3.2]);
    const [before, after] = [surfaceTopEdge(TURNED), surfaceTopEdge(moved)];
    near(after[0]!, before[0]!);
    near(after[3]!, before[3]!);
  });

  it('상판(z+)은 바닥을 고정한 채 높이만 바꾸고, yaw 는 [-π, π] 로 감는다', () => {
    const raised = shape(run({ type: 'face', face: 'z+', delta: 0.3 }));
    expect(raised.center[2] - raised.size[2] / 2).toBeCloseTo(0, 12);
    expect(obbWorkSurface(raised).topHeightM).toBeCloseTo(0.8, 12);
    const turned = shape(run({ type: 'rotate', axis: 'yaw', radians: Math.PI }));
    expect(turned.yaw).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('숫자 입력: 폭·깊이는 중심을 지키고, 도 단위 yaw·비유한 값·0 크기는 거부한다', () => {
    const apply = (field: Parameters<typeof objectFieldOperations>[1], value: number) => {
      const ops = objectFieldOperations(obb, field, value);
      return ops && applyEditOperations({ kind: 'obb', ...obb }, ops, WORK_SURFACE_OBB_POLICY);
    };
    const wide = obbWorkSurface(shape(apply('width', 3)!));
    near(wide.centerXy, [2, 3]);
    expect(wide.sizeXy[0]).toBeCloseTo(3, 12);
    expect(obbWorkSurface(shape(apply('topHeight', 1)!)).topHeightM).toBeCloseTo(1, 12);
    expect(obbWorkSurface(shape(apply('yaw', -0.25)!)).yawRad).toBeCloseTo(-0.25, 12);
    expect(objectFieldOperations(obb, 'yaw', 90)).toBeNull();
    expect(objectFieldOperations(obb, 'centerX', Number.NaN)).toBeNull();
    expect(apply('width', 0)).toMatchObject({ ok: false, reason: 'INVALID_GEOMETRY' });
    expect(apply('topHeight', -0.1)).toMatchObject({ ok: false, reason: 'INVALID_GEOMETRY' });
  });
});

// ---- 편집 세션: 같은 Store·수명 규칙을 구역과 함께 쓴다 ----

const DESK1 = { type: 'object', id: 'desk-1' } as const;
const PODIUM = { type: 'object', id: 'podium-1' } as const;
const Z1 = { type: 'zone', id: 'z-01' } as const;

let viewer: ReturnType<typeof createViewerStore>;
let data: ReturnType<typeof createSpatialDataStore>;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;
const objectResults: ViewerObjectEditResult[] = [];

const ingest = (raw: unknown = structuredClone(DEMO_WORK_SURFACES)) =>
  data.getState().ingestWorkSurfaces({ ok: true, raw }, T0);
const session = () => edit.store.getState().objectSession!;

describe('작업면 편집 세션', () => {
  beforeEach(() => {
    viewer = createViewerStore('LIVE');
    viewer.getState().markReady();
    for (const id of ['podium-1', 'desk-1'])
      viewer.getState().registerTarget({ type: 'object', id });
    viewer.getState().registerTarget(Z1);
    data = createSpatialDataStore();
    data.getState().reset('mock:normal:1');
    data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
    ingest();
    edit = createEditStore(viewer, data);
    off = edit.connect();
    objectResults.length = 0;
    edit.store.subscribe((s, p) => {
      if (s.lastObjectResult && s.lastObjectResult !== p.lastObjectResult)
        objectResults.push(s.lastObjectResult);
    });
  });
  afterEach(() => off());

  it('시작하면 그 작업면을 선택하고 원본 OBB 사본·확인한 출처만 기록한다', () => {
    expect(edit.store.getState().begin(DESK1)).toEqual({ ok: true });
    expect(viewer.getState().selected).toEqual(DESK1);
    expect(session().base).toEqual({
      center: [2.4, 3.6, 0.37],
      size: [1.2, 0.6, 0.74],
      yaw: 0.5236,
    });
    expect(session().provenance).toEqual({
      sourceId: 'mock:normal:1',
      geometryContract: 'OPERATIONAL_GEOMETRY_UNCONFIRMED',
      surfacesReceivedAt: T0,
      geometryVersion: 'demo-og-1',
      sceneVersion: null,
      configVersion: null,
    });
  });

  it('회전·상판 변경 뒤 완료하면 계약 필드 전후 값을 돌려주고 원본 작업면·구역 결과는 그대로다', () => {
    const snapshot = data.getState().workSurfaces;
    const copy = structuredClone(snapshot);
    edit.store.getState().begin(DESK1);
    edit.store.getState().previewObject(session().draft, {
      type: 'rotate',
      axis: 'yaw',
      radians: 0.2,
    });
    expect(edit.store.getState().updateObjectField('topHeight', 0.9)).toEqual({ ok: true });
    const result = edit.store.getState().finishObject();
    expect(result).toMatchObject({
      status: 'FINISHED',
      target: DESK1,
      mode: 'LIVE',
      before: { centerXy: [2.4, 3.6], sizeXy: [1.2, 0.6], yawRad: 0.5236, topHeightM: 0.74 },
      changed: true,
      saved: false,
    });
    if (result?.status !== 'FINISHED' || result.objectKind !== 'WORK_SURFACE')
      throw new Error('작업면 FINISHED 가 아니다');
    near(result.after.centerXy, [2.4, 3.6]);
    expect(result.after.yawRad).toBeCloseTo(0.7236, 12);
    expect(result.after.topHeightM).toBeCloseTo(0.9, 12);
    expect(data.getState().workSurfaces).toBe(snapshot);
    expect(data.getState().workSurfaces).toEqual(copy);
    expect(edit.store.getState().lastResult).toBeNull();
    expect(objectResults).toEqual([result]);
  });

  it('취소하면 초안만 버리고 원본을 돌려준다. 잘못된 숫자 입력은 초안을 그대로 둔다', () => {
    edit.store.getState().begin(DESK1);
    const draft = session().draft;
    expect(edit.store.getState().updateObjectField('yaw', 90)).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(edit.store.getState().updateObjectField('width', 0)).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(session().draft).toEqual(draft);
    expect(session().refused?.reason).toBe('INVALID_GEOMETRY');
    edit.store.getState().setObjectDragging('move');
    expect(edit.store.getState().updateObjectField('width', 1.5)).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(edit.store.getState().finishObject()).toBeNull();
    edit.store.getState().setObjectDragging(null);
    expect(edit.store.getState().cancelObject('USER')).toMatchObject({
      status: 'CANCELLED',
      reason: 'USER',
      before: { centerXy: [2.4, 3.6], sizeXy: [1.2, 0.6], yawRad: 0.5236, topHeightM: 0.74 },
      saved: false,
    });
  });

  it('시작할 수 없으면 이유를 알린다: 없음·미등록·REPLAY·준비 전', () => {
    const begin = (input: unknown) => edit.store.getState().begin(input);
    expect(begin({ type: 'object', id: 'desk-bad' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    // desk-2 는 묶음에 있지만 장면에 등록(Selectable)되지 않았다.
    expect(begin({ type: 'object', id: 'desk-2' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    viewer.getState().setMode('REPLAY');
    expect(begin(DESK1)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    const fresh = createViewerStore('LIVE');
    expect(createEditStore(fresh, data).store.getState().begin(DESK1)).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(objectResults.map((r) => r.status)).toEqual(['REJECTED', 'REJECTED', 'REJECTED']);
  });

  it('구역 편집과 작업면 편집은 동시에 열리지 않는다(REPLACED)', () => {
    edit.store.getState().begin(Z1);
    edit.store.getState().begin(DESK1);
    expect(edit.store.getState().session).toBeNull();
    expect(edit.store.getState().lastResult).toMatchObject({
      status: 'CANCELLED',
      reason: 'REPLACED',
    });
    edit.store.getState().begin(Z1);
    expect(edit.store.getState().objectSession).toBeNull();
    expect(objectResults.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'REPLACED' });
    // 다른 작업면으로 바꿔도 앞 작업면은 REPLACED 로 끝난다.
    edit.store.getState().begin(DESK1);
    edit.store.getState().begin(PODIUM);
    expect(objectResults.at(-1)).toMatchObject({ target: DESK1, reason: 'REPLACED' });
    expect(session().target).toEqual(PODIUM);
  });

  it('원본 작업면이 바뀌거나 사라지고 Source 가 바뀌면 STALE_SOURCE 로 끝낸다. 같은 형상 재수신은 그대로다', () => {
    edit.store.getState().begin(DESK1);
    ingest();
    expect(edit.store.getState().objectSession).not.toBeNull();
    const changed = structuredClone(DEMO_WORK_SURFACES);
    Object.assign(changed.work_surfaces[1]!, { yaw_rad: 0.6 });
    ingest(changed);
    expect(objectResults.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'STALE_SOURCE' });
    ingest();
    edit.store.getState().begin(DESK1);
    const gone = structuredClone(DEMO_WORK_SURFACES);
    gone.work_surfaces.splice(1, 1);
    ingest(gone);
    expect(objectResults.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: '원본 작업면이 사라졌다',
    });
    ingest();
    edit.store.getState().begin(DESK1);
    data.getState().reset('mock:normal:2');
    expect(objectResults.at(-1)).toMatchObject({ reason: 'STALE_SOURCE' });
  });

  it('선택·모드가 바뀌면 끝내고, 뷰어가 내려가면 UNMOUNTED 로 취소한다', () => {
    edit.store.getState().begin(DESK1);
    viewer.getState().select(PODIUM);
    expect(objectResults.at(-1)).toMatchObject({ reason: 'SELECTION_CHANGED' });
    edit.store.getState().begin(DESK1);
    viewer.getState().setMode('PLANNED');
    expect(objectResults.at(-1)).toMatchObject({ reason: 'MODE_CHANGED' });
    edit.store.getState().begin(DESK1);
    viewer.getState().setMode('REPLAY');
    expect(objectResults.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'NOT_EDITABLE' });
    viewer.getState().setMode('LIVE');
    edit.store.getState().begin(DESK1);
    off();
    expect(objectResults.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'UNMOUNTED' });
    off = () => {};
  });

  it('여러 작업면을 차례로 편집해도 결과가 섞이지 않는다', () => {
    edit.store.getState().begin(DESK1);
    edit.store.getState().updateObjectField('centerX', 3);
    const first = edit.store.getState().finishObject();
    edit.store.getState().begin(PODIUM);
    edit.store.getState().updateObjectField('depth', 1.5);
    const second = edit.store.getState().finishObject();
    expect(first).toMatchObject({ target: DESK1, after: { centerXy: [3, 3.6] } });
    expect(second).toMatchObject({ target: PODIUM, before: { sizeXy: [2.4, 1.1] } });
    if (second?.status !== 'FINISHED' || second.objectKind !== 'WORK_SURFACE')
      throw new Error('작업면 FINISHED 가 아니다');
    expect(second.after.sizeXy[1]).toBeCloseTo(1.5, 12);
    near(second.after.centerXy, [7.6, 7.4]);
  });

  it('결과 afterItem 은 계약 항목이고 받은 원본의 다른 키를 그대로 싣는다', () => {
    const withMeta = structuredClone(DEMO_WORK_SURFACES);
    Object.assign(withMeta.work_surfaces[1]!, { top_height_sigma_m: 0.03, name: '책상 1' });
    ingest(withMeta);
    edit.store.getState().begin(DESK1);
    edit.store.getState().updateObjectField('centerY', 4);
    const result = edit.store.getState().finishObject();
    expect(result).toMatchObject({
      status: 'FINISHED',
      origin: 'REGISTERED',
      afterItem: {
        surface_id: 'desk-1',
        top_height_m: 0.74,
        size_xy: [1.2, 0.6],
        yaw_rad: 0.5236,
        top_height_sigma_m: 0.03,
        name: '책상 1',
      },
    });
    if (result?.status !== 'FINISHED') throw new Error('FINISHED 가 아니다');
    near(result.afterItem.center_xy as number[], [2.4, 4]);
  });

  it('새 작업면: 처음 형상으로 NEW 세션을 열어 선택 대상에 올리고, 끝나면 내리며 결과 항목을 돌려준다', () => {
    const seed = {
      centerXy: [8, 5] as [number, number],
      sizeXy: [1.2, 0.6] as [number, number],
      yawRad: 0,
      topHeightM: 0.74,
    };
    const NEW = { type: 'object', id: 'new-1' } as const;
    expect(edit.store.getState().createObject({ id: 'new-1', geometry: seed })).toEqual({
      ok: true,
    });
    expect(viewer.getState().targets.has('object:new-1')).toBe(true);
    expect(viewer.getState().selected).toEqual(NEW);
    expect(session().origin).toBe('NEW');
    edit.store
      .getState()
      .previewObject(session().draft, { type: 'rotate', axis: 'yaw', radians: 0.3 });
    const result = edit.store.getState().finishObject();
    expect(result).toMatchObject({
      status: 'FINISHED',
      origin: 'NEW',
      target: NEW,
      before: seed,
      changed: true,
      saved: false,
      afterItem: {
        surface_id: 'new-1',
        top_height_m: 0.74,
        center_xy: [8, 5],
        size_xy: [1.2, 0.6],
      },
    });
    expect(viewer.getState().targets.has('object:new-1')).toBe(false);
    expect(viewer.getState().selected).toBeNull();
    // 원본 묶음에는 들어가지 않는다(등록·저장은 FE·BE).
    expect(data.getState().workSurfaces.surfaces.map((s) => s.surfaceId)).toEqual([
      'podium-1',
      'desk-1',
      'desk-2',
    ]);
    // 취소해도 임시 대상은 내려간다.
    edit.store.getState().createObject({ id: 'new-2', geometry: seed });
    edit.store.getState().cancelObject('USER');
    expect(viewer.getState().targets.has('object:new-2')).toBe(false);
    expect(objectResults.at(-1)).toMatchObject({ status: 'CANCELLED', origin: 'NEW' });
  });

  it('새 작업면은 빈·floor·이미 있는 ID 와 틀린 형상(도 단위 yaw·0 크기)을 거부하고, 같은 ID 가 들어오면 STALE 로 끝낸다', () => {
    const create = (id: unknown, patch: Record<string, unknown> = {}) =>
      edit.store.getState().createObject({
        id,
        geometry: { centerXy: [8, 5], sizeXy: [1.2, 0.6], yawRad: 0, topHeightM: 0.74, ...patch },
      });
    expect(create('')).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(create('floor')).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(create('desk-1')).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(create('n', { yawRad: 90 })).toEqual({ ok: false, reason: 'INVALID_GEOMETRY' });
    expect(create('n', { sizeXy: [0, 1] })).toEqual({ ok: false, reason: 'INVALID_GEOMETRY' });
    expect(create('n', { topHeightM: Number.NaN })).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    viewer.getState().setMode('REPLAY');
    expect(create('n')).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    viewer.getState().setMode('LIVE');
    expect(create('n')).toEqual({ ok: true });
    const arrived = structuredClone(DEMO_WORK_SURFACES);
    arrived.work_surfaces.push({
      surface_id: 'n',
      top_height_m: 0.5,
      center_xy: [1, 1],
      size_xy: [1, 1],
      yaw_rad: 0,
    });
    ingest(arrived);
    expect(objectResults.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'STALE_SOURCE' });
    expect(viewer.getState().targets.has('object:n')).toBe(false);
  });
});

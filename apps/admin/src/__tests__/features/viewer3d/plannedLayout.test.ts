import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { DEMO_PLANNED_LAYOUT } from '@/features/viewer3d/dev-harness/PlannedPanel';
import {
  DEMO_WORK_SURFACES,
  DEMO_ZONES_RESPONSE,
  scenarioWorld,
} from '@/features/viewer3d/dev-harness/scenarios';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import type { ViewerPlannedEditResult } from '@/features/viewer3d/editing/editTypes';
import {
  createPlannedStore,
  plannedGeometryProblem,
  readPlannedLayout,
} from '@/features/viewer3d/planned/plannedLayout';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// -186 PLANNED 가상 배치: 입력 검사, 같은 OBB 엔진으로 만들기·고르기·이동·회전·크기, World 결과, LIVE/REPLAY 격리.

const T = 1_760_342_400_000;
const OPEN = { type: 'planned', id: 'plan-open-1' } as const;
const SCAF = { type: 'planned', id: 'plan-scaf-1' } as const;

describe('readPlannedLayout', () => {
  it('개구부·비계·장비를 받고 모르는 종류는 이유와 함께 뺀다', () => {
    const snapshot = readPlannedLayout(DEMO_PLANNED_LAYOUT);
    expect(snapshot.layoutId).toBe('tbm-demo-1');
    expect(snapshot.objects.map((o) => [o.id, o.kind])).toEqual([
      ['plan-open-1', 'OPENING'],
      ['plan-scaf-1', 'SCAFFOLD'],
      ['plan-equip-1', 'EQUIPMENT'],
    ]);
    expect(snapshot.invalid).toEqual([
      {
        id: 'plan-bad',
        reason: 'kind 는 OPENING·WORK_SURFACE·SCAFFOLD·EQUIPMENT 중 하나여야 한다',
      },
    ]);
  });

  it('고소 작업면(WORK_SURFACE)도 같은 형상으로 받는다', () => {
    const snapshot = readPlannedLayout({
      layoutId: 'tbm-ws',
      objects: [
        {
          id: 'plan-ws-1',
          kind: 'WORK_SURFACE',
          geometry: { center: [3, 2, 0.2], size: [1, 1, 0.4], yawRad: 0 },
        },
      ],
    });
    expect(snapshot.invalid).toEqual([]);
    expect(snapshot.objects.map((o) => [o.id, o.kind])).toEqual([['plan-ws-1', 'WORK_SURFACE']]);
  });

  it.each([
    [
      'center 모양',
      { center: [1, 1], size: [1, 1, 1], yawRad: 0 },
      'center 는 유한수 3개여야 한다',
    ],
    ['크기 0', { center: [1, 1, 1], size: [1, 0, 1], yawRad: 0 }, 'size 는 양수 3개여야 한다'],
    [
      '도 값 yaw',
      { center: [1, 1, 1], size: [1, 1, 1], yawRad: 90 },
      'yawRad 는 [-π, π] 라디안이어야 한다',
    ],
    ['NaN', { center: [1, NaN, 1], size: [1, 1, 1], yawRad: 0 }, 'center 는 유한수 3개여야 한다'],
  ])('%s 이면 형상을 거부한다', (_n, geometry, reason) => {
    expect(plannedGeometryProblem(geometry)).toBe(reason);
  });

  it('없거나 null 이면 빈 배치, 배열이 아니면 거부, 같은 id 는 모두 뺀다', () => {
    expect(readPlannedLayout(null).objects).toEqual([]);
    expect(readPlannedLayout({ objects: {} }).invalid).toEqual([
      { id: null, reason: 'objects 가 배열이 아니다' },
    ]);
    const geometry = { center: [1, 1, 1], size: [1, 1, 1], yawRad: 0 };
    const dup = readPlannedLayout({
      objects: [
        { id: 'a', kind: 'SCAFFOLD', geometry },
        { id: 'a', kind: 'EQUIPMENT', geometry },
        { id: 'b', kind: 'OPENING', geometry },
      ],
    });
    expect(dup.objects.map((o) => o.id)).toEqual(['b']);
    expect(dup.invalid).toEqual([
      { id: 'a', reason: 'id 중복' },
      { id: 'a', reason: 'id 중복' },
    ]);
  });
});

describe('PLANNED 편집 코어', () => {
  let viewer: ReturnType<typeof createViewerStore>;
  let data: ReturnType<typeof createSpatialDataStore>;
  let planned: ReturnType<typeof createPlannedStore>;
  let edit: ReturnType<typeof createEditStore>;
  let off: () => void;
  const results: ViewerPlannedEditResult[] = [];
  const objectResults: unknown[] = [];

  beforeEach(() => {
    viewer = createViewerStore('PLANNED');
    viewer.getState().markReady();
    data = createSpatialDataStore();
    data.getState().reset('src');
    data.getState().ingest(scenarioWorld('normal', 0, T), T);
    data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T);
    data.getState().ingestWorkSurfaces({ ok: true, raw: structuredClone(DEMO_WORK_SURFACES) }, T);
    planned = createPlannedStore();
    planned.getState().setInput(structuredClone(DEMO_PLANNED_LAYOUT));
    // PlannedLayer 가 PLANNED 모드에서 올리는 장면 대상.
    for (const o of planned.getState().snapshot.objects)
      viewer.getState().registerTarget({ type: 'planned', id: o.id });
    viewer.getState().registerTarget({ type: 'object', id: 'desk-1' });
    edit = createEditStore(viewer, data, planned);
    off = edit.connect();
    results.length = 0;
    objectResults.length = 0;
    edit.store.subscribe((s, p) => {
      if (s.lastPlannedResult && s.lastPlannedResult !== p.lastPlannedResult)
        results.push(s.lastPlannedResult);
      if (s.lastObjectResult && s.lastObjectResult !== p.lastObjectResult)
        objectResults.push(s.lastObjectResult);
    });
  });
  afterEach(() => off());

  const session = () => edit.store.getState().objectSession!;

  it('고르면 PLANNED 정책 OBB 세션이 열리고, 이동·Z 이동·수평 회전·면 조작이 World 결과로 나온다', () => {
    expect(edit.store.getState().begin(SCAF)).toEqual({ ok: true });
    expect(viewer.getState().selected).toEqual(SCAF);
    expect(session()).toMatchObject({
      objectKind: 'PLANNED',
      plannedKind: 'SCAFFOLD',
      layoutId: 'tbm-demo-1',
    });
    expect(session().policy.name).toBe('planned-obb');
    const s = edit.store.getState();
    expect(s.previewObject(session().draft, { type: 'translate', delta: [0.5, 0, 0] }).ok).toBe(
      true,
    );
    expect(s.previewObject(session().draft, { type: 'translate', delta: [0, 0, 0.25] }).ok).toBe(
      true,
    );
    expect(
      s.previewObject(session().draft, { type: 'rotate', axis: 'yaw', radians: Math.PI / 6 }).ok,
    ).toBe(true);
    expect(s.previewObject(session().draft, { type: 'face', face: 'z+', delta: 0.5 }).ok).toBe(
      true,
    );
    expect(
      s.previewObject(session().draft, { type: 'rotate', axis: 'pitch', radians: 0.1 }).ok,
    ).toBe(false);
    const result = edit.store.getState().finishPlanned()!;
    expect(result).toMatchObject({
      status: 'FINISHED',
      target: SCAF,
      mode: 'PLANNED',
      origin: 'REGISTERED',
      plannedKind: 'SCAFFOLD',
      layoutId: 'tbm-demo-1',
      changed: true,
      saved: false,
    });
    if (result.status !== 'FINISHED') throw new Error('FINISHED 가 아니다');
    expect(result.before).toEqual({ center: [8.6, 8.2, 1.5], size: [2, 0.8, 3], yawRad: 0 });
    expect(result.after.center.map((v) => +v.toFixed(9))).toEqual([9.1, 8.2, 2]);
    expect(result.after.size.map((v) => +v.toFixed(9))).toEqual([2, 0.8, 3.5]);
    expect(result.after.yawRad).toBeCloseTo(Math.PI / 6, 12);
    // LIVE object 결과 콜백에는 아무것도 가지 않는다.
    expect(objectResults).toEqual([]);
  });

  it('LIVE·REPLAY 에서는 가상 객체를 열지도 만들지도 않는다', () => {
    viewer.getState().setMode('LIVE');
    expect(edit.store.getState().begin(OPEN)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    viewer.getState().setMode('REPLAY');
    expect(
      edit.store.getState().createPlanned({
        id: 'x',
        kind: 'EQUIPMENT',
        geometry: { center: [1, 1, 0.5], size: [1, 1, 1], yawRad: 0 },
      }),
    ).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    expect(results.map((r) => r.status === 'REJECTED' && r.detail)).toEqual([
      '가상 배치는 PLANNED 모드에서만 편집한다',
      '가상 배치는 PLANNED 모드에서만 편집한다',
    ]);
  });

  it('편집 중 모드가 바뀌면 끝난다: LIVE 는 취소, REPLAY 는 거부', () => {
    edit.store.getState().begin(OPEN);
    viewer.getState().setMode('LIVE');
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'MODE_CHANGED' });
    viewer.getState().setMode('PLANNED');
    edit.store.getState().begin(OPEN);
    viewer.getState().setMode('REPLAY');
    expect(results.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'NOT_EDITABLE' });
    expect(edit.store.getState().objectSession).toBeNull();
  });

  it('새 가상 객체를 만들면 임시 대상으로 올렸다가 끝나면 내리고, ID·종류·형상이 틀리면 열지 않는다', () => {
    const geometry = { center: [5, 2.5, 0.5], size: [0.8, 0.8, 1], yawRad: 0 };
    expect(
      edit.store.getState().createPlanned({ id: 'plan-new-1', kind: 'EQUIPMENT', geometry }),
    ).toEqual({ ok: true });
    expect(viewer.getState().targets.has('planned:plan-new-1')).toBe(true);
    edit.store.getState().previewObject(session().draft, { type: 'translate', delta: [0, 1, 0] });
    expect(edit.store.getState().finishPlanned()).toMatchObject({
      status: 'FINISHED',
      origin: 'NEW',
      plannedKind: 'EQUIPMENT',
      after: { center: [5, 3.5, 0.5], size: [0.8, 0.8, 1], yawRad: 0 },
    });
    expect(viewer.getState().targets.has('planned:plan-new-1')).toBe(false);
    const create = (input: unknown) => edit.store.getState().createPlanned(input);
    expect(create({ id: '', kind: 'EQUIPMENT', geometry })).toEqual({
      ok: false,
      reason: 'INVALID_TARGET',
    });
    expect(create({ id: 'plan-open-1', kind: 'EQUIPMENT', geometry })).toEqual({
      ok: false,
      reason: 'INVALID_TARGET',
    });
    expect(create({ id: 'n', kind: 'CRANE', geometry })).toEqual({
      ok: false,
      reason: 'INVALID_TARGET',
    });
    expect(create({ id: 'n', kind: 'OPENING', geometry: { ...geometry, yawRad: 45 } })).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
  });

  it('편집 중 배치에서 그 객체가 바뀌거나 사라지거나 배치가 바뀌면 STALE_SOURCE 로 끝난다', () => {
    const next = (objects: typeof DEMO_PLANNED_LAYOUT.objects, layoutId = 'tbm-demo-1') =>
      planned.getState().setInput({ layoutId, objects: structuredClone(objects) });
    edit.store.getState().begin(OPEN);
    next(DEMO_PLANNED_LAYOUT.objects.filter((o) => o.id !== 'plan-open-1'));
    expect(results.at(-1)).toMatchObject({
      status: 'REJECTED',
      reason: 'STALE_SOURCE',
      detail: '원본 가상 객체가 사라졌다',
    });
    next(DEMO_PLANNED_LAYOUT.objects);
    edit.store.getState().begin(OPEN);
    next(DEMO_PLANNED_LAYOUT.objects, 'tbm-demo-2');
    expect(results.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: '가상 배치(layoutId)가 바뀌었다',
    });
    // 같은 값으로 다시 넘기면(새 객체) 끝내지 않는다.
    edit.store.getState().begin(OPEN);
    next(DEMO_PLANNED_LAYOUT.objects, 'tbm-demo-2');
    expect(edit.store.getState().objectSession?.target).toEqual(OPEN);
  });

  it('가상 배치 편집은 LIVE World·구역·작업면·이벤트를 바꾸지 않는다', () => {
    const before = data.getState();
    edit.store.getState().begin(SCAF);
    edit.store.getState().previewObject(session().draft, { type: 'translate', delta: [1, 0, 0] });
    edit.store.getState().finishPlanned();
    const after = data.getState();
    expect(after.world).toBe(before.world);
    expect(after.zones).toBe(before.zones);
    expect(after.workSurfaces).toBe(before.workSurfaces);
    expect(after.events).toBe(before.events);
    // LIVE 작업면 편집과 가상 객체 편집은 서로를 바뀐 것으로 끝낸다(동시에 하나).
    edit.store.getState().begin(OPEN);
    edit.store.getState().begin({ type: 'object', id: 'desk-1' });
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'REPLACED' });
    expect(edit.store.getState().objectSession?.objectKind).toBe('WORK_SURFACE');
  });

  it('초안으로 한 번에 다시 열고(before 비교), 취소하면 원본이 그대로다', () => {
    const before = { center: [6.2, 6, 0.05], size: [1.2, 0.8, 0.1], yawRad: 0 };
    const draft = { ...before, center: [6.7, 6, 0.05] };
    expect(edit.store.getState().begin(OPEN, { before, draft } as never)).toEqual({ ok: true });
    expect(edit.store.getState().cancelPlanned()).toMatchObject({
      status: 'CANCELLED',
      reason: 'USER',
      before,
    });
    expect(planned.getState().snapshot.objects[0]).toMatchObject({ center: [6.2, 6, 0.05] });
    expect(
      edit.store.getState().begin(OPEN, { before: { ...before, yawRad: 0.2 } } as never),
    ).toEqual({
      ok: false,
      reason: 'STALE_SOURCE',
    });
  });
});

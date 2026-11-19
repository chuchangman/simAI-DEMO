import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import {
  DEMO_STATIC_OBJECTS_BE_V1,
  DEMO_ZONES_BE_V1,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import {
  createEditStore,
  objectPreviewOf,
  previewOf,
} from '@/features/viewer3d/editing/editSession.store';
import type {
  ViewerEditResult,
  ViewerObjectEditPreview,
  ViewerObjectEditResult,
} from '@/features/viewer3d/editing/editTypes';
import { DEFAULT_LAYERS, resolveLayers } from '@/features/viewer3d/layers';
import type { ViewerSelectRequest } from '@/features/viewer3d/types';
import { createViewerStore, MAX_SELECT_WAIT_MS } from '@/features/viewer3d/viewer3d.store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -234 Viewer 조작 코어(Store 수준): 기다리는 선택, 레이어 값, 미저장 초안 한 번에 다시 열기, 정식 형상 출처.
// 장면·클릭은 layers/WebGL 시험에서 본다.

const T = 1_760_342_400_000;
const Z1 = { type: 'zone', id: 'z-01' } as const;
const Z3 = { type: 'zone', id: 'z-03' } as const;
/** 등록 반영이 끝난 뒤(마이크로태스크) 고른다. */
const flush = () => Promise.resolve();

let viewer: ReturnType<typeof createViewerStore>;
let requests: ViewerSelectRequest[];

beforeEach(() => {
  vi.useFakeTimers();
  viewer = createViewerStore('LIVE');
  requests = [];
  viewer.subscribe((s, p) => {
    if (s.selectRequest && s.selectRequest !== p.selectRequest) requests.push(s.selectRequest);
  });
});
afterEach(() => vi.useRealTimers());

describe('기다리는 선택(select waitMs)', () => {
  it('준비 전·장면에 없는 대상은 기다렸다가 올라오면 고르고 초점을 맞춘다', async () => {
    expect(viewer.getState().requestSelect(Z1, { waitMs: 3000, focus: true })).toEqual({
      ok: true,
      pending: true,
    });
    viewer.getState().markReady();
    await flush();
    expect(viewer.getState().selected).toBeNull();
    viewer.getState().registerTarget(Z1);
    await flush();
    expect(viewer.getState().selected).toEqual(Z1);
    expect(viewer.getState().focus).toEqual({ target: Z1 });
    expect(requests.map((r) => r.status)).toEqual(['PENDING', 'APPLIED']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('StrictMode 처럼 등록→해제→등록을 한 번에 거쳐도 선택을 잃지 않고, 실제로 내려가면 계속 기다린다', async () => {
    viewer.getState().markReady();
    viewer.getState().requestSelect(Z1, { waitMs: 3000 });
    viewer.getState().registerTarget(Z1);
    viewer.getState().unregisterTarget(Z1);
    viewer.getState().registerTarget(Z1);
    await flush();
    expect(viewer.getState().selected).toEqual(Z1);
    expect(requests.map((r) => r.status)).toEqual(['PENDING', 'APPLIED']);

    viewer.getState().requestSelect(Z3, { waitMs: 3000 });
    viewer.getState().registerTarget(Z3);
    viewer.getState().unregisterTarget(Z3);
    await flush();
    expect(viewer.getState().pendingSelect?.target).toEqual(Z3);
    expect(requests.at(-1)?.status).toBe('PENDING');
  });

  it('시간이 지나면 EXPIRED 이고 고르지 않는다', () => {
    viewer.getState().markReady();
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    vi.advanceTimersByTime(1000);
    viewer.getState().registerTarget(Z1);
    expect(viewer.getState().selected).toBeNull();
    expect(requests.map((r) => r.status)).toEqual(['PENDING', 'EXPIRED']);
  });

  it('새 요청·다른 대상 선택·해제·오류·뷰어 내려감은 기다리던 요청을 취소한다', () => {
    viewer.getState().markReady();
    viewer.getState().registerTarget(Z3);
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    viewer.getState().select(Z3);
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    viewer.getState().clearSelection();
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    viewer.getState().dispose();
    viewer.getState().requestSelect(Z1, { waitMs: 1000 });
    viewer.getState().markError({ code: 'CONTEXT_LOST', message: 'x' });
    expect(requests.filter((r) => r.status === 'CANCELLED').map((r) => r.reason)).toEqual([
      'REPLACED',
      'SELECTION_CHANGED',
      'SELECTION_CHANGED',
      'UNMOUNTED',
      'NOT_READY',
    ]);
    expect(vi.getTimerCount()).toBe(0);
    // 오류 상태에서는 기다리지 않고 바로 실패한다.
    expect(viewer.getState().requestSelect(Z1, { waitMs: 1000 })).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
  });

  it('지금 고를 수 있으면 바로 고르고(진행 알림 없음), 모양이 틀리면 기다리지 않는다', () => {
    viewer.getState().markReady();
    viewer.getState().registerTarget(Z1);
    expect(viewer.getState().requestSelect(Z1, { waitMs: 1000, focus: true })).toEqual({
      ok: true,
    });
    expect(viewer.getState().focus).toEqual({ target: Z1 });
    expect(viewer.getState().requestSelect({ type: 'zone', id: ' ' }, { waitMs: 1000 })).toEqual({
      ok: false,
      reason: 'INVALID_TARGET',
    });
    // waitMs 없음·0 은 예전 select 와 같다.
    expect(viewer.getState().requestSelect(Z3)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(requests).toEqual([]);
  });

  it('기다리는 시간은 상한(MAX_SELECT_WAIT_MS)으로 자른다', async () => {
    viewer.getState().markReady();
    viewer.getState().requestSelect(Z1, { waitMs: 10 * MAX_SELECT_WAIT_MS });
    viewer.getState().registerTarget(Z1);
    await flush();
    expect(requests.at(-1)?.status).toBe('APPLIED');
    viewer.getState().requestSelect(Z3, { waitMs: 10 * MAX_SELECT_WAIT_MS });
    vi.advanceTimersByTime(MAX_SELECT_WAIT_MS);
    expect(requests.at(-1)?.status).toBe('EXPIRED');
  });
});

describe('레이어 값', () => {
  it('적지 않은 레이어·모르는 값은 interactive 이고, 같은 값이면 같은 객체다', () => {
    expect(resolveLayers(undefined)).toBe(DEFAULT_LAYERS);
    expect(resolveLayers({ zones: 'interactive', obstacles: 'bogus' })).toBe(DEFAULT_LAYERS);
    expect(resolveLayers({ obstacles: 'visible', workSurfaces: 'hidden' })).toEqual({
      zones: 'interactive',
      workSurfaces: 'hidden',
      obstacles: 'visible',
    });
    viewer.getState().setLayers({ zones: 'visible' });
    const first = viewer.getState().layers;
    viewer.getState().setLayers({ zones: 'visible' });
    expect(viewer.getState().layers).toBe(first);
  });
});

describe('편집 코어: 정식 형상·초안 다시 열기', () => {
  let data: ReturnType<typeof createSpatialDataStore>;
  let edit: ReturnType<typeof createEditStore>;
  let off: () => void;
  const results: ViewerEditResult[] = [];
  const objectResults: ViewerObjectEditResult[] = [];
  const previews: string[] = [];

  beforeEach(() => {
    viewer.getState().markReady();
    for (const id of ['z-01', 'z-02', 'z-03'])
      viewer.getState().registerTarget({ type: 'zone', id });
    for (const id of ['desk-1', 'so-projector'])
      viewer.getState().registerTarget({ type: 'object', id });
    data = createSpatialDataStore();
    data.getState().reset('src');
    data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_BE_V1) }, T);
    data
      .getState()
      .ingestWorkSurfaces({ ok: true, raw: structuredClone(DEMO_STATIC_OBJECTS_BE_V1) }, T);
    edit = createEditStore(viewer, data);
    off = edit.connect();
    results.length = 0;
    objectResults.length = 0;
    previews.length = 0;
    edit.store.subscribe((s, p) => {
      if (s.lastResult && s.lastResult !== p.lastResult) results.push(s.lastResult);
      if (s.lastObjectResult && s.lastObjectResult !== p.lastObjectResult)
        objectResults.push(s.lastObjectResult);
      if (s.session && s.session.draft !== p.session?.draft)
        previews.push(JSON.stringify(previewOf(s.session).draft));
    });
  });
  afterEach(() => off());

  it('정식 BOX 구역은 zone_version 을 출처에 싣고, 버전만 올라가도 STALE_SOURCE 로 끝난다', () => {
    expect(edit.store.getState().begin(Z1)).toEqual({ ok: true });
    expect(edit.store.getState().session!.provenance).toMatchObject({
      zoneContract: 'BE_ZONES_V1',
      zoneVersion: 3,
    });
    const next = structuredClone(DEMO_ZONES_BE_V1);
    next[0]!.zone_version = 4;
    data.getState().ingestZones({ ok: true, raw: next }, T + 1);
    expect(results.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'STALE_SOURCE' });
  });

  it('다각형·바닥 판정 구역은 상자 편집을 열지 않는다', () => {
    expect(edit.store.getState().begin(Z3)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    expect(edit.store.getState().begin({ type: 'zone', id: 'z-02' })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
    expect(results.map((r) => r.status === 'REJECTED' && r.detail)).toEqual([
      '직사각형이 아닌 구역은 3D 상자로 편집하지 않는다',
      '바닥 판정 구역은 높이가 판정에 쓰이지 않아 3D 상자로 편집하지 않는다',
    ]);
  });

  it('초안으로 한 번에 다시 열면 미리보기 한 번에 그 초안이고 원본(before)은 그대로다', () => {
    const before = { min: [1.5, 5.5, 0], max: [4.5, 8.5, 2] } as const;
    const draft = { min: [2, 5.5, 0], max: [5, 8.5, 2.5] } as const;
    expect(
      edit.store.getState().begin(Z1, {
        before: structuredClone(before) as never,
        draft: structuredClone(draft) as never,
      }),
    ).toEqual({ ok: true });
    expect(previews).toEqual([JSON.stringify(draft)]);
    const preview = previewOf(edit.store.getState().session!);
    expect(preview.before).toEqual(before);
    const finished = edit.store.getState().finish();
    expect(finished).toMatchObject({
      status: 'FINISHED',
      after: draft,
      changed: true,
      saved: false,
    });
  });

  it('원본이 그새 바뀌었거나 초안이 틀리면 편집을 열지 않는다(부분 적용 없음)', () => {
    const stale = { min: [0, 5.5, 0], max: [4.5, 8.5, 2] };
    expect(edit.store.getState().begin(Z1, { before: stale as never })).toEqual({
      ok: false,
      reason: 'STALE_SOURCE',
    });
    const inverted = { min: [5, 5.5, 0], max: [4.5, 8.5, 2] };
    expect(edit.store.getState().begin(Z1, { draft: inverted as never })).toEqual({
      ok: false,
      reason: 'INVALID_GEOMETRY',
    });
    expect(edit.store.getState().session).toBeNull();
    expect(viewer.getState().selected).toBeNull();
  });

  it('레이어가 조작 가능하지 않으면 편집을 열지 않는다', () => {
    viewer.getState().setLayers({ zones: 'visible', workSurfaces: 'visible' });
    expect(edit.store.getState().begin(Z1)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    expect(edit.store.getState().begin({ type: 'object', id: 'desk-1' })).toEqual({
      ok: false,
      reason: 'NOT_EDITABLE',
    });
    viewer.getState().setLayers({});
    expect(edit.store.getState().begin(Z1)).toEqual({ ok: true });
  });

  it('작업면·장애물 초안도 한 번에 다시 열고 object_version 을 출처에 싣는다', () => {
    const desk = data.getState().workSurfaces.surfaces.find((s) => s.surfaceId === 'desk-1')!;
    const before = {
      centerXy: [...desk.centerXy],
      sizeXy: [...desk.sizeXy],
      yawRad: desk.yawRad,
      topHeightM: desk.topHeightM,
    };
    const draft = { ...before, topHeightM: 0.9 };
    expect(
      edit.store.getState().begin({ type: 'object', id: 'desk-1' }, { before, draft } as never),
    ).toEqual({ ok: true });
    const preview: ViewerObjectEditPreview = objectPreviewOf(edit.store.getState().objectSession!);
    expect(preview).toMatchObject({
      objectKind: 'WORK_SURFACE',
      draft: { topHeightM: 0.9 },
      provenance: { geometryContract: 'BE_STATIC_OBJECTS_V1', objectVersion: 2 },
    });
    expect(edit.store.getState().finishObject()).toMatchObject({
      status: 'FINISHED',
      afterItem: { surface_id: 'desk-1', top_height_m: 0.9, object_version: 2 },
    });

    const obstacle = { center: [5, 5.5, 2.6], size: [0.4, 0.3, 0.15], yawRad: 0.3 };
    expect(
      edit.store.getState().begin({ type: 'object', id: 'so-projector' }, {
        before: obstacle,
        draft: { ...obstacle, center: [5, 5.5, 2.2] },
      } as never),
    ).toEqual({ ok: true });
    expect(objectPreviewOf(edit.store.getState().objectSession!)).toMatchObject({
      objectKind: 'OBSTACLE',
      draft: { center: [5, 5.5, 2.2] },
    });
    expect(
      edit.store.getState().begin({ type: 'object', id: 'so-projector' }, {
        draft: { ...obstacle, yawRad: 7 },
      } as never),
    ).toEqual({ ok: false, reason: 'INVALID_GEOMETRY' });
    // 거부해도 진행 중 편집과 그 초안은 그대로다.
    expect(objectPreviewOf(edit.store.getState().objectSession!).draft).toMatchObject({
      center: [5, 5.5, 2.2],
    });
  });

  it('DEMO 구역의 출처 값은 예전 모양 그대로다(zoneVersion 키 없음)', () => {
    data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T + 2);
    expect(edit.store.getState().begin(Z1)).toEqual({ ok: true });
    expect(Object.keys(edit.store.getState().session!.provenance).sort()).toEqual([
      'configVersion',
      'sceneVersion',
      'sourceId',
      'zoneContract',
      'zonesReceivedAt',
    ]);
  });
});

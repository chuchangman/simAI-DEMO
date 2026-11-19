import { createSpatialDataStore } from '@/features/viewer3d/data/spatialData.store';
import { DEMO_ZONES_RESPONSE, scenarioWorld } from '@/features/viewer3d/dev-harness/scenarios';
import { createEditStore } from '@/features/viewer3d/editing/editSession.store';
import type { ViewerEditResult } from '@/features/viewer3d/editing/editTypes';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const T0 = 1_760_342_400_000;
const Z1 = { type: 'zone', id: 'z-01' } as const;
const Z3 = { type: 'zone', id: 'z-03' } as const;

let viewer: ReturnType<typeof createViewerStore>;
let data: ReturnType<typeof createSpatialDataStore>;
let edit: ReturnType<typeof createEditStore>;
let off: () => void;
const results: ViewerEditResult[] = [];

const zones = () => data.getState().zones;
const world = (tick: number, scene?: string) => {
  const raw = structuredClone(scenarioWorld('normal', tick, T0)) as {
    msg_id: string;
    payload: { scene_version: string };
  };
  if (scene) raw.payload.scene_version = scene;
  return raw;
};

beforeEach(() => {
  viewer = createViewerStore('LIVE');
  viewer.getState().markReady();
  for (const id of ['z-01', 'z-02', 'z-03']) viewer.getState().registerTarget({ type: 'zone', id });
  viewer.getState().registerTarget({ type: 'person', id: 'w-0001' });
  data = createSpatialDataStore();
  data.getState().reset('mock:normal:1');
  data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0);
  edit = createEditStore(viewer, data);
  off = edit.connect();
  results.length = 0;
  edit.store.subscribe((s, p) => {
    if (s.lastResult && s.lastResult !== p.lastResult) results.push(s.lastResult);
  });
});
afterEach(() => off());

describe('편집 세션', () => {
  it('F07: 드래그 중에는 외부 finish 명령도 종료 결과를 만들지 않는다', () => {
    edit.store.getState().begin(Z1);
    edit.store.getState().setDragging('move');
    expect(edit.store.getState().finish()).toBeNull();
    expect(edit.store.getState().session).not.toBeNull();
    expect(results).toHaveLength(0);
    edit.store.getState().setDragging(null);
    expect(edit.store.getState().finish()?.status).toBe('FINISHED');
    expect(results).toHaveLength(1);
  });

  it('시작하면 그 구역을 선택하고 원본 사본·확인 가능한 출처만 기록한다', () => {
    expect(edit.store.getState().begin(Z1)).toEqual({ ok: true });
    expect(viewer.getState().selected).toEqual(Z1);
    const session = edit.store.getState().session!;
    expect(session.base).toEqual({ min: [1.5, 5.5, 0], max: [4.5, 8.5, 2] });
    expect(session.provenance).toEqual({
      sourceId: 'mock:normal:1',
      zoneContract: 'DEMO_UNCONFIRMED',
      zonesReceivedAt: T0,
      sceneVersion: null,
      configVersion: null,
    });
  });

  it('미리보기·완료는 원본 ZoneSnapshot·선택·위험 이벤트를 바꾸지 않고 World 전후 값을 돌려준다', () => {
    const snapshot = zones();
    const copy = structuredClone(snapshot);
    const events = data.getState().events;
    edit.store.getState().begin(Z1);
    const from = edit.store.getState().session!.draft;
    edit.store.getState().preview(from, { type: 'translate', delta: [0.5, -0.25, 0] });
    const moved = edit.store.getState().session!.draft;
    edit.store.getState().preview(moved, { type: 'face', face: 'z+', delta: 0.4 });
    const result = edit.store.getState().finish();
    expect(result).toEqual({
      status: 'FINISHED',
      target: Z1,
      mode: 'LIVE',
      before: { min: [1.5, 5.5, 0], max: [4.5, 8.5, 2] },
      after: { min: [2, 5.25, 0], max: [5, 8.25, 2.4] },
      changed: true,
      provenance: expect.objectContaining({ sourceId: 'mock:normal:1' }),
      saved: false,
    });
    expect(zones()).toBe(snapshot);
    expect(zones()).toEqual(copy);
    expect(data.getState().events).toBe(events);
    expect(viewer.getState().selected).toEqual(Z1);
    expect(edit.store.getState().session).toBeNull();
  });

  it('거부된 미리보기는 초안을 직전 유효 값에 두고 이유를 남긴다', () => {
    edit.store.getState().begin(Z1);
    const from = edit.store.getState().session!.draft;
    const out = edit.store.getState().preview(from, { type: 'face', face: 'x+', delta: -5 });
    expect(out).toMatchObject({ ok: false, reason: 'INVALID_GEOMETRY' });
    expect(edit.store.getState().session!.draft).toEqual(from);
    expect(edit.store.getState().session!.refused?.reason).toBe('INVALID_GEOMETRY');
    expect(edit.store.getState().finish()).toMatchObject({ status: 'FINISHED', changed: false });
  });

  it('취소하면 초안만 버리고 원본은 그대로다', () => {
    const copy = structuredClone(zones());
    edit.store.getState().begin(Z3);
    const from = edit.store.getState().session!.draft;
    edit.store.getState().preview(from, { type: 'face', face: 'z-', delta: -0.5 });
    expect(edit.store.getState().cancel('USER')).toMatchObject({
      status: 'CANCELLED',
      reason: 'USER',
      before: { min: [4.5, 7.5, 1.2], max: [6.5, 9, 2.4] },
      saved: false,
    });
    expect(zones()).toEqual(copy);
  });

  it('시작할 수 없는 대상·모드·상태는 이유와 함께 거부하고, 진행 중 편집은 그대로 둔다', () => {
    const begin = (input: unknown) => edit.store.getState().begin(input);
    expect(begin({ type: 'person', id: 'w-0001' })).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    expect(begin({ type: 'zone', id: 'missing' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(begin({ type: 'zone' })).toEqual({ ok: false, reason: 'INVALID_TARGET' });
    expect(begin(Z1)).toEqual({ ok: true });
    // 작업면(object)은 -188 부터 편집 대상이지만 작업면 입력이 없으면 NOT_FOUND 이고 구역 편집은 그대로다.
    expect(begin({ type: 'object', id: 'desk' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(edit.store.getState().session?.target).toEqual(Z1);
    edit.store.getState().cancel();
    viewer.getState().setMode('REPLAY');
    expect(begin(Z1)).toEqual({ ok: false, reason: 'NOT_EDITABLE' });
    const fresh = createViewerStore('LIVE');
    expect(createEditStore(fresh, data).store.getState().begin(Z1)).toEqual({
      ok: false,
      reason: 'NOT_READY',
    });
    expect(results.at(-1)).toMatchObject({
      status: 'REJECTED',
      reason: 'NOT_EDITABLE',
      saved: false,
    });
  });

  it('다른 구역 편집으로 바꾸면 이전 편집을 REPLACED 로 취소한다', () => {
    edit.store.getState().begin(Z1);
    edit.store.getState().begin(Z3);
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'REPLACED', target: Z1 });
    expect(edit.store.getState().session?.target).toEqual(Z3);
    expect(viewer.getState().selected).toEqual(Z3);
  });

  it('선택 변경·모드 변경은 취소, REPLAY·렌더 오류는 거부로 끝낸다', () => {
    edit.store.getState().begin(Z1);
    viewer.getState().select({ type: 'person', id: 'w-0001' });
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'SELECTION_CHANGED' });
    edit.store.getState().begin(Z1);
    viewer.getState().clearSelection();
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'SELECTION_CHANGED' });
    edit.store.getState().begin(Z1);
    viewer.getState().setMode('PLANNED');
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'MODE_CHANGED' });
    edit.store.getState().begin(Z1);
    expect(edit.store.getState().session?.mode).toBe('PLANNED');
    viewer.getState().setMode('REPLAY');
    expect(results.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'NOT_EDITABLE' });
    viewer.getState().setMode('LIVE');
    edit.store.getState().begin(Z1);
    viewer.getState().markError({ code: 'CONTEXT_LOST', message: 'x' });
    expect(results.at(-1)).toMatchObject({ status: 'REJECTED', reason: 'NOT_READY' });
  });

  it('같은 형상의 구역을 다시 받으면 이어 가고, 형상이 바뀌거나 사라지면 STALE_SOURCE 로 끝낸다', () => {
    edit.store.getState().begin(Z1);
    data.getState().ingestZones({ ok: true, raw: structuredClone(DEMO_ZONES_RESPONSE) }, T0 + 1);
    expect(edit.store.getState().session).not.toBeNull();
    const changed = structuredClone(DEMO_ZONES_RESPONSE);
    changed.zones[0]!.aabb.max_xyz = [4.6, 8.5, 2];
    data.getState().ingestZones({ ok: true, raw: changed }, T0 + 2);
    expect(results.at(-1)).toMatchObject({
      status: 'REJECTED',
      reason: 'STALE_SOURCE',
      detail: '원본 구역 형상이 바뀌었다',
    });
    edit.store.getState().begin(Z3);
    data.getState().ingestZones({ ok: false, reason: 'HTTP 503' }, T0 + 3);
    expect(results.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: '원본 구역이 사라졌다',
    });
  });

  it('입력 Source·Scene 버전이 바뀌면 STALE_SOURCE 로 끝낸다', () => {
    data.getState().ingest(world(0), T0);
    edit.store.getState().begin(Z1);
    expect(edit.store.getState().session?.provenance.sceneVersion).toBe('scene-demo-1');
    data.getState().ingest(world(1), T0 + 100);
    expect(edit.store.getState().session).not.toBeNull();
    data.getState().ingest(world(2, 'scene-demo-2'), T0 + 200);
    expect(results.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: expect.stringContaining('Scene'),
    });
    edit.store.getState().begin(Z1);
    data.getState().reset('mock:normal:2');
    expect(results.at(-1)).toMatchObject({
      reason: 'STALE_SOURCE',
      detail: '입력 Source 가 바뀌었다',
    });
  });

  it('해제(뷰어 내려감)하면 진행 중인 편집을 UNMOUNTED 로 취소한다', () => {
    edit.store.getState().begin(Z1);
    off();
    off = () => {};
    expect(results.at(-1)).toMatchObject({ status: 'CANCELLED', reason: 'UNMOUNTED' });
  });
});

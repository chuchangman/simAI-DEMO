import { zoneOf } from '@/__tests__/features/zones/zoneFixture';
import type { SurfaceGeometry, WorkSurface } from '@/features/surfaces/types';
import type { ViewerEditBox } from '@/features/viewer3d';
import {
  boxEditOf,
  changedPatch,
  currentSurface,
  defaultNewBox,
  editedBox,
  formWithPatch,
  ghostsOf,
  isEmptyDraft,
  NEW_KEY,
  newSurfaceDraft,
  newZoneForm,
  nextZoneName,
  resizeBox,
  surfaceBox,
  surfaceBoxEditable,
  surfaceChanged,
  surfaceDraftOf,
  surfaceOfBox,
  takenZoneNames,
  targetChanged,
  uniqueZoneName,
  withoutName,
  withoutUnchangedSurface,
  withPatch,
  withSurface,
  withSurfaceBox,
  withZoneBox,
  zoneChanged,
  zoneFollowsSurface,
  type TargetDraft,
} from '@/features/zones/zoneEditModel';
import { surfaceZoneShape } from '@/features/zones/zoneShape';
import type { RoomLimit } from '@/lib/roomLimit';
import { DEFAULT_ROOM_LIMIT, roomLimitFrom } from '@/lib/roomLimit';
import { describe, expect, it } from 'vitest';

const zone = zoneOf(
  { zoneId: 'z-04', name: '개구부', min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] },
  { severity: 'CRITICAL', zoneType: 'PLATFORM' },
);
const linked: WorkSurface = {
  objectId: 'ws-1',
  version: 2,
  name: '단상',
  geometry: { centerXy: [7, 2.5], sizeXy: [1, 1], yawRad: 0, topHeightM: 0.4 },
  sigma: null,
  zoneId: null,
  validFrom: 1,
  workId: null,
  layoutId: null,
  layoutItemId: null,
};

describe('작업면 ↔ 3D 편집 상자', () => {
  it('상자는 바닥(0)부터 상판까지이고, 되돌리면 같은 형상이다', () => {
    const box = surfaceBox(linked.geometry);
    expect(box).toEqual({ min: [6.5, 2, 0], max: [7.5, 3, 0.4] });
    expect(surfaceOfBox(box, linked.geometry)).toEqual(linked.geometry);
  });

  it('상자를 고쳐도 회전은 받은 값을 그대로 둔다', () => {
    const turned = { ...linked.geometry, yawRad: -0.2618 };
    const next = surfaceOfBox({ min: [1, 1, 0], max: [2, 3, 0.7] }, turned);
    expect(next).toEqual({ centerXy: [1.5, 2], sizeXy: [1, 2], yawRad: -0.2618, topHeightM: 0.7 });
    expect(surfaceBoxEditable(turned)).toBe(false);
    expect(surfaceBoxEditable(linked.geometry)).toBe(true);
  });

  it('새 작업면은 구역 상자 가운데에 1×1 m, 상판 0.4 m 이고 아직 등록하지 않았다(id null)', () => {
    const draft = newSurfaceDraft({ min: [2, 2, 0], max: [4, 6, 2] });
    expect(draft).toEqual({
      id: null,
      name: null,
      geometry: { centerXy: [3, 4], sizeXy: [1, 1], yawRad: 0, topHeightM: 0.4 },
    });
  });
});

describe('새 구역의 처음 상자', () => {
  const SCAN_ROOM = roomLimitFrom({ min: [1, 2, 0], max: [7, 12, 3] });

  it('구역이 없으면 방 가운데에 2×2×2 m 이다', () => {
    expect(defaultNewBox([], DEFAULT_ROOM_LIMIT)).toEqual({ min: [4, 4, 0], max: [6, 6, 2] });
  });

  it('스캔 범위가 주어지면 구역이 없을 때 스캔 가운데에 둔다', () => {
    expect(defaultNewBox([], SCAN_ROOM)).toEqual({ min: [3, 6, 0], max: [5, 8, 2] });
  });

  it('스캔 범위가 주어지면 구역 가운데도 스캔 경계 안으로 가둔다', () => {
    const box = defaultNewBox(
      [{ zoneId: 'a', name: 'a', min: [9, 9, 0], max: [10, 10, 2] }],
      SCAN_ROOM,
    );
    expect(box).toEqual({ min: [5, 8.5, 0], max: [7, 10.5, 2] });
  });

  it('넘긴 범위를 그대로 쓴다', () => {
    expect(defaultNewBox([], { min: [0, 0, 0], max: [4, 6, 5] })).toEqual({
      min: [1, 2, 0],
      max: [3, 4, 2],
    });
  });

  it('구역들을 감싼 상자의 가운데이고 교실 안에 가둔다', () => {
    const box = defaultNewBox(
      [
        { zoneId: 'a', name: 'a', min: [9, 9, 0], max: [10, 10, 2] },
        { zoneId: 'b', name: 'b', min: [9.5, 9.5, 0], max: [10, 10, 2] },
      ],
      DEFAULT_ROOM_LIMIT,
    );
    expect(box).toEqual({ min: [8, 8, 0], max: [10, 10, 2] });
  });
});

describe('저장 전에 고친 것', () => {
  it('이름·심각도는 저장된 값과 같으면 고친 것이 아니다', () => {
    expect(changedPatch(zone, { name: '개구부', severity: 'HIGH' })).toEqual({ severity: 'HIGH' });
    expect(formWithPatch(zone, { name: 'x' })).toMatchObject({
      name: 'x',
      severity: 'CRITICAL',
      zoneType: 'PLATFORM',
      judgeType: 'VOLUME_3D',
    });
  });

  it('상자는 원본과 같으면 고친 것이 아니다', () => {
    const same: TargetDraft = { patch: {}, box: { min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] } };
    const moved: TargetDraft = { patch: {}, box: { min: [5.9, 1.2, 0], max: [8.7, 3.8, 2.4] } };
    expect(zoneChanged(zone, same)).toBe(false);
    expect(zoneChanged(zone, moved)).toBe(true);
    expect(zoneChanged(zone, undefined)).toBe(false);
  });

  it('작업면: 건드리지 않음 · 같은 값 · 새로 만듦 · 값을 바꿈', () => {
    expect(surfaceChanged(undefined, linked)).toBe(false);
    expect(surfaceChanged(surfaceDraftOf(linked), linked)).toBe(false);
    expect(surfaceChanged(newSurfaceDraft({ min: [0, 0, 0], max: [2, 2, 2] }), null)).toBe(true);
    const taller = surfaceDraftOf(linked);
    taller.geometry.topHeightM = 0.9;
    expect(surfaceChanged(taller, linked)).toBe(true);
    // 이름 앞뒤 공백은 같은 이름이다
    expect(surfaceChanged({ ...surfaceDraftOf(linked), name: ' 단상 ' }, linked)).toBe(false);
  });

  it('지금 보이는 작업면: 건드렸으면 그 값, 아니면 이은 작업면', () => {
    expect(currentSurface(undefined, linked)?.id).toBe('ws-1');
    const edited = { ...surfaceDraftOf(linked), name: '고침' };
    expect(currentSurface({ patch: {}, box: null, surface: edited }, linked)).toBe(edited);
    expect(currentSurface(undefined, null)).toBeNull();
  });

  it('구역이나 작업면 하나라도 고쳤으면 고친 대상이다', () => {
    const taller = surfaceDraftOf(linked);
    taller.geometry.topHeightM = 0.9;
    expect(targetChanged(zone, undefined, linked)).toBe(false);
    expect(targetChanged(zone, { patch: {}, box: null, surface: taller }, linked)).toBe(true);
    expect(targetChanged(zone, { patch: { name: 'x' }, box: null }, null)).toBe(true);
  });
});

describe('초안 갱신', () => {
  const ORIGINAL: ViewerEditBox = { min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] };
  const MOVED: ViewerEditBox = { min: [6.8, 1.2, 0], max: [9.6, 3.8, 2.4] };

  it('이름·심각도: 저장된 값과 같은 칸은 빼고, 새 구역은 그대로 둔다', () => {
    const named = withPatch(undefined, zone, { name: '새 이름' });
    expect(named.patch).toEqual({ name: '새 이름' });
    expect(withPatch(named, zone, { name: zone.name }).patch).toEqual({});
    expect(withPatch(undefined, null, { name: zone.name }).patch).toEqual({ name: zone.name });
  });

  it('작업면을 고치면 작업면 칸만 바뀌고 이름·상자 초안은 그대로다', () => {
    const next = surfaceDraftOf(linked);
    expect(withSurface(undefined, next)).toEqual({ patch: {}, box: null, surface: next });
    expect(withSurface({ patch: { name: 'x' }, box: MOVED }, next)).toEqual({
      patch: { name: 'x' },
      box: MOVED,
      surface: next,
    });
    expect(withPatch({ patch: {}, box: null, surface: next }, zone, { name: 'x' }).surface).toBe(
      next,
    );
  });

  it('작업면 상자를 끌면 그 형상만 바뀌고 회전은 그대로다', () => {
    const next = withSurfaceBox(undefined, surfaceDraftOf(linked), {
      min: [6.5, 2, 0],
      max: [7.5, 3, 0.9],
    });
    expect(next.surface?.geometry).toMatchObject({
      centerXy: [7, 2.5],
      topHeightM: 0.9,
      yawRad: 0,
    });
  });

  it('구역 상자를 끌면 상자가 초안이 되고, 원본과 같아지면 지운다', () => {
    expect(withZoneBox(undefined, zone, MOVED).box).toBe(MOVED);
    expect(withZoneBox({ patch: {}, box: MOVED }, zone, ORIGINAL).box).toBeNull();
    expect(withZoneBox(undefined, null, MOVED).box).toBe(MOVED);
  });

  it('구역 상자를 끌어도 이름 고침과 작업면 초안은 그대로 이어받는다', () => {
    const surface = surfaceDraftOf(linked);
    const prev: TargetDraft = { patch: { name: 'x' }, box: null, surface };
    expect(withZoneBox(prev, zone, MOVED)).toEqual({
      patch: { name: 'x' },
      box: MOVED,
      surface,
    });
  });

  it('고친 칸·상자·작업면이 하나도 없으면 빈 초안이다', () => {
    expect(isEmptyDraft({ patch: {}, box: null })).toBe(true);
    expect(isEmptyDraft({ patch: { name: 'x' }, box: null })).toBe(false);
    expect(isEmptyDraft({ patch: {}, box: MOVED })).toBe(false);
    expect(isEmptyDraft({ patch: {}, box: null, surface: surfaceDraftOf(linked) })).toBe(false);
  });

  it('원본과 다르게 고친 상자만 저장할 상자다', () => {
    expect(editedBox(zone, undefined)).toBeNull();
    expect(editedBox(zone, { patch: {}, box: ORIGINAL })).toBeNull();
    expect(editedBox(zone, { patch: {}, box: MOVED })).toBe(MOVED);
  });

  it('새 구역 양식은 고르지 않는 칸을 기본값으로 채우고 고친 칸만 덮는다', () => {
    expect(newZoneForm({}, '구역 1')).toEqual({
      name: '구역 1',
      judgeType: 'VOLUME_3D',
      zoneType: 'OPENING',
      severity: 'HIGH',
    });
    expect(newZoneForm({ name: 'A', severity: 'CRITICAL' }, '구역 1')).toMatchObject({
      name: 'A',
      severity: 'CRITICAL',
    });
  });

  it('고친 이름은 기본 이름보다 우선한다(AI 구역 초안 이름이 `구역 N` 을 이긴다)', () => {
    expect(newZoneForm({ name: '개구부 구역' }, nextZoneName([])).name).toBe('개구부 구역');
  });
});

describe('nextZoneName', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it('구역이 없으면 `위험구역 1`, 작업면 구역이면 `고소작업면 A` 다', () => {
    expect(nextZoneName([])).toBe('위험구역 1');
    expect(nextZoneName([], 'surface')).toBe('고소작업면 A');
    expect(nextZoneName([], 'opening')).toBe('개구부 1');
  });

  it('겹치지 않는 가장 작은 구분자를 붙인다(빈 구분자도 채운다)', () => {
    expect(nextZoneName(named('위험구역 1'))).toBe('위험구역 2');
    expect(nextZoneName(named('위험구역 1', '위험구역 3'))).toBe('위험구역 2');
    expect(nextZoneName(named('위험구역 2'))).toBe('위험구역 1');
    expect(nextZoneName(named('고소작업면 A', '고소작업면 C'), 'surface')).toBe('고소작업면 B');
  });

  it('다른 이름의 구역이나 구분자 없는 종류 이름은 구분자를 차지하지 않고, 앞뒤 공백은 같은 이름으로 본다', () => {
    expect(nextZoneName(named('개구부 구역', '단상 구역', '위험구역', '구역 1'))).toBe(
      '위험구역 1',
    );
    expect(nextZoneName(named(' 위험구역 1 '))).toBe('위험구역 2');
  });

  it('A~Z 를 다 쓰면 숫자로 이어 간다', () => {
    const all = named(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `고소작업면 ${c}`));
    expect(nextZoneName(all, 'surface')).toBe('고소작업면 27');
  });
});

describe('uniqueZoneName', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));

  it('활성 구역과 겹치지 않으면 그대로(앞뒤 공백만 뗀다)', () => {
    expect(uniqueZoneName(' 작업대 상판 ', named('단상'), 'surface')).toBe('작업대 상판');
  });

  it('겹치면 끝의 구분자를 떼고 비어 있는 가장 작은 구분자를 붙인다', () => {
    expect(uniqueZoneName('작업대 상판', named('작업대 상판'), 'surface')).toBe('작업대 상판 A');
    expect(uniqueZoneName('작업대 상판', named('작업대 상판', '작업대 상판 A'), 'surface')).toBe(
      '작업대 상판 B',
    );
    expect(uniqueZoneName('고소작업면 A', named('고소작업면 A'), 'surface')).toBe('고소작업면 B');
    expect(uniqueZoneName('개구부 1', named('개구부 1', '개구부 2'), 'opening')).toBe('개구부 3');
  });
});

describe('takenZoneNames', () => {
  it('지금 고치는 구역을 빼고 앞뒤 공백을 뗀 이름들이다', () => {
    const zones = [
      { zoneId: 'z-1', name: ' 개구부 1 ' },
      { zoneId: 'z-2', name: '단상' },
    ];
    expect([...takenZoneNames(zones, 'z-2')]).toEqual(['개구부 1']);
    expect(takenZoneNames(zones).size).toBe(2);
  });
});

describe('resizeBox', () => {
  const box = { min: [2, 3, 0], max: [4, 6, 2] } as ViewerEditBox;
  const room: RoomLimit = { min: [0, 0, 0], max: [10, 10, 5] };

  it('가로·세로는 가운데를 두고 늘이고 줄이며, 높이는 바닥을 두고 위를 옮긴다', () => {
    expect(resizeBox(box, 0, 3, room)).toEqual({ min: [1.5, 3, 0], max: [4.5, 6, 2] });
    expect(resizeBox(box, 1, 1, room)).toEqual({ min: [2, 4, 0], max: [4, 5, 2] });
    expect(resizeBox(box, 2, 2.5, room)).toEqual({ min: [2, 3, 0], max: [4, 6, 2.5] });
  });

  it('교실 범위를 넘는 쪽은 경계에서 자르고, 숫자가 아니거나 최소 크기보다 작으면 null 이다', () => {
    expect(resizeBox(box, 0, 8, room)).toEqual({ min: [0, 3, 0], max: [7, 6, 2] });
    expect(resizeBox(box, 0, 0.1, room)).toBeNull();
    expect(resizeBox(box, 2, 0.01, room)).toBeNull();
    expect(resizeBox(box, 1, Number.NaN, room)).toBeNull();
  });
});

describe('작업면 구역과 받은 구역 비교', () => {
  const geometry: SurfaceGeometry = {
    centerXy: [5, 4],
    sizeXy: [2, 1],
    yawRad: 0,
    topHeightM: 1.2,
  };
  const shape = surfaceZoneShape(geometry);
  const matching = zoneOf(
    { zoneId: 'z-s', name: '작업면 구역', min: [3.7, 3.2, 0], max: [6.3, 4.8, 2] },
    { severity: 'HIGH', judgeType: 'VOLUME_3D' },
  );

  it('모양·높이·입체 판정이 모두 같으면 이미 작업면을 따르는 구역이다', () => {
    expect(zoneFollowsSurface(matching, shape)).toBe(true);
  });

  it('심각도는 사용자가 고르므로 위험이어도 작업면을 따르는 구역이다', () => {
    expect(zoneFollowsSurface({ ...matching, severity: 'CRITICAL' }, shape)).toBe(true);
  });

  it('모양·높이·판정 유형 중 하나라도 다르면 따르지 않는다', () => {
    expect(
      zoneFollowsSurface({ ...matching, polygon: [...matching.polygon].reverse() }, shape),
    ).toBe(false);
    expect(zoneFollowsSurface({ ...matching, zBounds: [0, 2.5] }, shape)).toBe(false);
    expect(zoneFollowsSurface({ ...matching, judgeType: 'GROUND_FOOTPRINT' }, shape)).toBe(false);
    expect(zoneFollowsSurface(matching, surfaceZoneShape({ ...geometry, yawRad: 0.3 }))).toBe(
      false,
    );
  });
});

describe('withoutName(이름 고침만 빼기)', () => {
  it('이름 고침만 빼고 심각도·상자·작업면은 그대로 둔다', () => {
    const box: ViewerEditBox = { min: [1, 1, 0], max: [2, 2, 1] };
    const draft: TargetDraft = {
      patch: { name: '고치는 중', severity: 'CRITICAL' },
      box,
      surface: surfaceDraftOf(linked),
    };
    expect(withoutName(draft)).toEqual({ ...draft, patch: { severity: 'CRITICAL' } });
    expect(draft.patch.name).toBe('고치는 중');
  });

  it('이름만 고친 초안은 비어 저장소에서 지워질 초안이 된다', () => {
    expect(isEmptyDraft(withoutName({ patch: { name: '고치는 중' }, box: null }))).toBe(true);
  });
});

describe('withoutUnchangedSurface(바뀐 것만 초안)', () => {
  const same = surfaceDraftOf(linked);
  const raised = { ...same, geometry: { ...same.geometry, topHeightM: 0.9 } };
  const added = newSurfaceDraft({ min: [2, 2, 0], max: [4, 6, 2] });

  it('이은 작업면과 값이 같아진 작업면 초안은 뺀다', () => {
    const draft: TargetDraft = { patch: { name: 'x' }, box: null, surface: same };
    expect(withoutUnchangedSurface(draft, linked)).toEqual({ patch: { name: 'x' }, box: null });
  });

  it('고친 작업면·새 작업면 초안은 그대로 둔다', () => {
    const edited: TargetDraft = { patch: {}, box: null, surface: raised };
    expect(withoutUnchangedSurface(edited, linked)).toBe(edited);
    const created: TargetDraft = { patch: {}, box: null, surface: added };
    expect(withoutUnchangedSurface(created, null)).toBe(created);
    expect(withoutUnchangedSurface(created, linked)).toBe(created);
  });

  it('작업면을 건드리지 않은 초안은 그대로다', () => {
    const draft: TargetDraft = { patch: { name: 'x' }, box: null };
    expect(withoutUnchangedSurface(draft, linked)).toBe(draft);
  });

  it('작업면만 원래대로 돌려놓으면 초안이 비어 저장소에서 지워진다', () => {
    const reverted = withoutUnchangedSurface({ patch: {}, box: null, surface: same }, linked);
    expect(isEmptyDraft(reverted)).toBe(true);
  });
});

describe('3D 로 내려 줄 값', () => {
  const BOX: ViewerEditBox = { min: [5.8, 1.2, 0], max: [8.6, 3.8, 2.4] };
  const base = {
    key: 'z-04',
    zone,
    zoneBox: BOX,
    surface: null,
    surfaceValid: true,
  };
  const withSurfaceOf = (geometry: SurfaceGeometry) => ({
    ...base,
    surface: surfaceDraftOf({ ...linked, geometry }),
  });

  it('작업면이 없으면 구역 상자, 있으면 작업면 상자다(구역은 작업면에서 계산한다)', () => {
    expect(boxEditOf(base)).toEqual({ id: 'z-04', kind: 'zone', box: BOX });
    expect(boxEditOf(withSurfaceOf(linked.geometry))).toMatchObject({
      id: 'surface:z-04',
      kind: 'surface',
    });
  });

  it('작업면이 틀렸거나 회전했으면 손잡이가 없다(구역 손잡이로 돌아가지 않는다)', () => {
    expect(boxEditOf({ ...withSurfaceOf(linked.geometry), surfaceValid: false })).toBeNull();
    expect(boxEditOf(withSurfaceOf({ ...linked.geometry, yawRad: 0.5 }))).toBeNull();
  });

  it('작업면이 없고 형상을 못 고치는 구역은 손잡이가 없다', () => {
    expect(boxEditOf({ ...base, zone: { ...zone, shapeEditable: false } })).toBeNull();
  });

  it('새 구역은 형상 제한이 없다', () => {
    expect(boxEditOf({ ...base, key: NEW_KEY, zone: null })).toMatchObject({ kind: 'zone' });
  });

  describe('윤곽(ghostsOf)', () => {
    const other = (zoneId: string) =>
      zoneOf({ zoneId, name: zoneId, min: [0, 0, 0], max: [1, 1, 1] });
    const ZONES = [zone, other('z-02'), other('z-05')];
    const links = new Map([['z-02', linked]]);
    const ghosts = (drafts: Record<string, TargetDraft>, key: string) =>
      ghostsOf(drafts, key, ZONES, links);

    it('고른 구역 말고 고친 상자가 있는 대상이다(없어진 구역은 뺀다)', () => {
      const drafts = {
        'z-04': { patch: {}, box: BOX },
        'z-gone': { patch: {}, box: BOX },
        [NEW_KEY]: { patch: {}, box: BOX },
        'z-05': { patch: { name: 'x' }, box: null },
      };
      expect(ghosts(drafts, 'z-04').map((g) => g.id)).toEqual([NEW_KEY]);
      expect(ghosts(drafts, NEW_KEY).map((g) => g.id)).toEqual(['z-04']);
    });

    it('작업면이 붙은 구역은 작업면에서 계산한 구역 윤곽이고, 고른 구역도 보인다', () => {
      const surface = surfaceDraftOf(linked);
      const [outline] = ghosts({ 'z-02': { patch: {}, box: null, surface } }, 'z-02');
      expect(outline).toEqual({
        id: 'z-02',
        box: { min: [6.2, 1.7, 0], max: [7.8, 3.3, 2] },
      });
    });

    it('작업면이 붙은 구역의 고친 상자는 쓰지 않고, 회전한 작업면은 윤곽을 두지 않는다', () => {
      const surface = surfaceDraftOf(linked);
      const withBox = { 'z-02': { patch: {}, box: BOX, surface } };
      expect(ghosts(withBox, 'z-04')[0]?.box.max[2]).toBe(2);
      const rotated = surfaceDraftOf({ ...linked, geometry: { ...linked.geometry, yawRad: 0.5 } });
      expect(ghosts({ 'z-02': { patch: {}, box: BOX, surface: rotated } }, 'z-04')).toEqual([]);
    });
  });
});

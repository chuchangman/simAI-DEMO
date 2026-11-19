import type { WorkSurface } from '@/features/surfaces/types';
import {
  applyEditBoxToDraftItem,
  buildLayoutBoxEdit,
  buildLayoutBoxGhosts,
  buildLayoutWriteBody,
  buildPlannedLayoutInput,
  createDraftItem,
  degToYawRad,
  draftItemToEditBox,
  draftItemToObb,
  importOpeningFromZone,
  layoutDetailToDraftItems,
  nextLayoutItemId,
  normalizeYawRad,
  obbToDraftItem,
  polygonToObb2D,
  validateLayoutDraft,
  yawRadToDeg,
} from '@/features/tbm/layoutEditorModel';
import type { Zone } from '@/features/zones/types';
import { describe, expect, it } from 'vitest';

const SAMPLE_SURFACE: WorkSurface = {
  objectId: 'ws-01',
  version: 1,
  name: '작업대 1',
  zoneId: null,
  geometry: {
    centerXy: [3.2, 4.5],
    sizeXy: [2.0, 1.5],
    yawRad: 0.25,
    topHeightM: 1.4,
  },
  sigma: 0.02,
  validFrom: 1760572800000,
  workId: null,
  layoutId: null,
  layoutItemId: null,
};

const ZONE_WITH_HEIGHT: Zone = {
  zoneId: 'z-04',
  name: '개구부 구역',
  min: [5.5, 1.5, 0],
  max: [7.5, 3.5, 0.4],
  version: 1,
  judgeType: 'VOLUME_3D',
  zoneType: 'OPENING',
  severity: 'CRITICAL',
  polygon: [
    [5.5, 1.5],
    [7.5, 1.5],
    [7.5, 3.5],
    [5.5, 3.5],
  ],
  zBounds: [0, 0.4],
  zRange: [0, 0.4],
  hasGuardrail: false,
  requirements: null,
  validFrom: 1760572800000,
  workId: null,
  layoutId: null,
  layoutItemId: null,
  shapeEditable: true,
};

const ZONE_WITHOUT_HEIGHT: Zone = {
  zoneId: 'z-02',
  name: '바닥 통로 구역',
  min: [2.0, 2.0, 0],
  max: [4.0, 5.0, 0.05],
  version: 1,
  judgeType: 'GROUND_FOOTPRINT',
  zoneType: 'PATH',
  severity: 'HIGH',
  polygon: [
    [2.0, 2.0],
    [4.0, 2.0],
    [4.0, 5.0],
    [2.0, 5.0],
  ],
  zBounds: [null, null],
  zRange: null,
  hasGuardrail: null,
  requirements: null,
  validFrom: 1760572800000,
  workId: null,
  layoutId: null,
  layoutItemId: null,
  shapeEditable: false,
};

describe('layoutEditorModel 순수 로직', () => {
  it('각도(도 ↔ 라디안)를 [-π, π] 범위로 변환한다', () => {
    expect(degToYawRad(0)).toBe(0);
    expect(degToYawRad(90)).toBeCloseTo(Math.PI / 2, 3);
    expect(yawRadToDeg(Math.PI / 2)).toBe(90);
    expect(Math.abs(normalizeYawRad(Math.PI * 3))).toBeLessThanOrEqual(3.1415927);
  });

  it('새 항목은 회전 없이 놓고 작업면 기본값과 구역 미리보기를 쓴다', () => {
    const floor = createDraftItem('WORK_SURFACE', []);
    expect(floor).toMatchObject({
      item_id: 'surf-01',
      kind: 'WORK_SURFACE',
      sizeXy: [1, 1],
      bottomZ: 0,
      height: 0.4,
      yaw_rad: 0,
    });
    const item = createDraftItem('OPENING', [floor], { surface: SAMPLE_SURFACE });
    expect(item).toMatchObject({ centerXy: [3.2, 4.5], bottomZ: 1.4, yaw_rad: 0 });
    expect(nextLayoutItemId('WORK_SURFACE', [floor])).toBe('surf-02');
    expect(buildLayoutBoxEdit(floor)?.kind).toBe('surface');
    expect(buildLayoutBoxEdit({ ...floor, yaw_rad: 0.25 })).toBeNull();
    const box = draftItemToEditBox(floor)!;
    expect(applyEditBoxToDraftItem(floor, box)).toMatchObject({
      centerXy: floor.centerXy,
      sizeXy: floor.sizeXy,
    });
    expect(
      buildLayoutBoxGhosts([floor, item], floor.item_id).some(
        (ghost) => ghost.id === 'zone:surf-01',
      ),
    ).toBe(true);
  });

  it('구역에서 가져오기: 높이가 있는 구역은 외접 OBB와 구역 높이로 OPENING을 만든다', () => {
    const imported = importOpeningFromZone(ZONE_WITH_HEIGHT, []);
    expect(imported).toMatchObject({
      item_id: 'open-z-04',
      kind: 'OPENING',
      label: '개구부 구역 (z-04)',
      centerXy: [6.5, 2.5],
      sizeXy: [2, 2],
      bottomZ: 0,
      height: 0.4,
      yaw_rad: 0,
    });

    const obb = draftItemToObb(imported);
    expect(obb).toEqual({
      item_id: 'open-z-04',
      kind: 'OPENING',
      center: [6.5, 2.5, 0.2],
      size: [2, 2, 0.4],
      yaw_rad: 0,
      label: '개구부 구역 (z-04)',
      source_zone_id: 'z-04',
    });
  });

  it('구역에서 가져오기: 회전된 다각형에서도 최소 면적 외접 OBB를 계산한다', () => {
    const angle = Math.PI / 6; // 30°
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // 중심 (4, 3), 폭 2, 깊이 1 인 회전 직사각형
    const corners: [number, number][] = [
      [-1, -0.5],
      [1, -0.5],
      [1, 0.5],
      [-1, 0.5],
    ].map(([u, v]) => [4 + u * c - v * s, 3 + u * s + v * c]);

    const obb2d = polygonToObb2D(corners);
    expect(obb2d.centerXy[0]).toBeCloseTo(4, 2);
    expect(obb2d.centerXy[1]).toBeCloseTo(3, 2);
    expect(obb2d.sizeXy[0] * obb2d.sizeXy[1]).toBeCloseTo(2, 2);
  });

  it('구역에서 가져오기: 높이가 없는 바닥 구역(zRange === null)은 기본값으로 채우지 않고 비워 두며 저장 전 검증으로 막는다(규칙 2)', () => {
    const imported = importOpeningFromZone(ZONE_WITHOUT_HEIGHT, []);
    expect(imported.bottomZ).toBeNull();
    expect(imported.height).toBeNull();
    expect(draftItemToObb(imported)).toBeNull();
    expect(draftItemToEditBox(imported)).toBeNull();

    // 비어 있는 상태에서 저장 검증 실패
    const problemBefore = validateLayoutDraft('바닥 레이아웃', [imported]);
    expect(problemBefore).toContain('바닥 높이(Z)가 비어 있습니다');
    expect(buildLayoutWriteBody('바닥 레이아웃', [imported])).toBeNull();

    // 바닥 높이만 채우고 높이를 비워 둔 상태에서도 저장 검증 실패
    const withBottomOnly = { ...imported, bottomZ: 0 };
    expect(validateLayoutDraft('바닥 레이아웃', [withBottomOnly])).toContain('높이(Z 크기)');

    // 사용자가 바닥 높이와 높이를 모두 입력하면 검증 통과 및 요청 본문 생성
    const completed = { ...imported, bottomZ: 0, height: 0.3 };
    expect(validateLayoutDraft('바닥 레이아웃', [completed])).toBeNull();
    const body = buildLayoutWriteBody('바닥 레이아웃', [completed], 2);
    expect(body).toEqual({
      name: '바닥 레이아웃',
      revision: 2,
      items: [
        {
          item_id: 'open-z-02',
          kind: 'OPENING',
          center: [3, 3.5, 0.15],
          size: [2, 3, 0.3],
          yaw_rad: 0,
          label: '바닥 통로 구역 (z-02)',
          source_zone_id: 'z-02',
        },
      ],
    });
  });

  it('LayoutDetail ↔ 초안 항목 변환 및 PlannedLayoutInput 생성이 동작한다', () => {
    const rawObb = {
      item_id: 'pos-01',
      kind: 'SCAFFOLD' as const,
      center: [6.1, 2.4, 1.2] as [number, number, number],
      size: [1.0, 2.4, 2.4] as [number, number, number],
      yaw_rad: 0,
      label: '비계 S1',
    };
    const draft = obbToDraftItem(rawObb);
    expect(draft).toEqual({
      item_id: 'pos-01',
      kind: 'WORK_SURFACE',
      label: '비계 S1',
      centerXy: [6.1, 2.4],
      sizeXy: [1.0, 2.4],
      bottomZ: 0,
      height: 2.4,
      yaw_rad: 0,
    });

    const items = layoutDetailToDraftItems({
      layout_id: 101,
      name: '레이아웃 101',
      revision: 3,
      items: [rawObb],
    });
    const planned = buildPlannedLayoutInput(101, items);
    expect(planned).toEqual({
      layoutId: 'layout-101',
      objects: [
        {
          id: 'pos-01',
          kind: 'WORK_SURFACE',
          label: '비계 S1',
          geometry: {
            center: [6.1, 2.4, 1.2],
            size: [1.0, 2.4, 2.4],
            yawRad: 0,
          },
        },
      ],
    });
  });
});

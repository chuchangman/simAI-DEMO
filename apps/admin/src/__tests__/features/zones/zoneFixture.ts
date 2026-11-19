import type { Zone, ZoneBox } from '@/features/zones/types';
import { boxToPolygon } from '@/features/zones/zones';

/** 시험용 서버 구역(v1). 상자에서 바닥 직사각형과 높이를 만들고, 속성은 기본값에 덮어쓴다. */
export function zoneOf(box: ZoneBox, attrs: Partial<Zone> = {}): Zone {
  return {
    ...box,
    version: 1,
    judgeType: 'VOLUME_3D',
    zoneType: 'OPENING',
    severity: 'HIGH',
    polygon: boxToPolygon(box),
    zBounds: [box.min[2], box.max[2]],
    zRange: [box.min[2], box.max[2]],
    hasGuardrail: null,
    requirements: null,
    validFrom: 1,
    workId: null,
    layoutId: null,
    layoutItemId: null,
    shapeEditable: true,
    ...attrs,
  };
}

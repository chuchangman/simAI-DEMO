import { adaptDemoZones } from '@/features/viewer3d/data/contractAdapter';
import type { ZoneSeverity, ZoneView } from '@/features/viewer3d/data/spatialFrame';
import { DEMO_ZONES_RESPONSE } from '@/features/viewer3d/dev-harness/scenarios';
import { PALETTE } from '@/features/viewer3d/palette';
import { worldPoint } from '@/features/viewer3d/worldCoordinates';
import { rectangleToAabb } from '@/features/viewer3d/zones/demoRectangle';
import {
  aerialGuides,
  boxEdges,
  FLOOR_GUIDE_LIFT,
  isAerialZone,
  zoneBox,
} from '@/features/viewer3d/zones/zoneGeometry';
import {
  personOnRay,
  ZONE_APPLY_STATES,
  zoneLabel,
  zoneSeverity,
  zoneStyle,
} from '@/features/viewer3d/zones/zonePresentation';
import { describe, expect, it } from 'vitest';

// -0 과 부동소수 꼬리를 정리해 기준 벡터와 비교한다.
const clean = (v: readonly number[]) => v.map((n) => Math.round(n * 1e9) / 1e9 + 0);
const zonesById = () =>
  new Map(adaptDemoZones(structuredClone(DEMO_ZONES_RESPONSE), 0).zones.map((z) => [z.zoneId, z]));

describe('구역 AABB → Three 상자', () => {
  // 지시서 기준 벡터(World m, Z-up → Three m, Y-up). 축 변환은 worldBoxToThree 한 번이다.
  it.each([
    ['z-01', [3, 1, -7], [3, 2, 3], 0],
    ['z-02', [7.75, 0.7, -2.25], [2.5, 1.4, 2.5], 0],
    ['z-03', [5.5, 1.8, -8.25], [2, 1.2, 1.5], 1.2],
  ])('%s 중심 %j 크기 %j, 하단 Three y=%s', (id, center, size, bottom) => {
    const zone = zonesById().get(id)!;
    const box = zoneBox(zone)!;
    expect(clean(box.position)).toEqual(center);
    expect(clean(box.size)).toEqual(size);
    // 하단 = 중심 − 높이/2 = World min Z. 바닥(0)에 붙이지 않는다.
    expect(clean([box.position[1] - box.size[1] / 2])).toEqual([bottom]);
    expect(clean([box.position[1] + box.size[1] / 2])).toEqual([zone.max[2]]);
  });

  it('z-03 만 공중 구역이고 z-bad 는 상자로 만들지 않는다', () => {
    const zones = zonesById();
    expect([...zones.keys()]).toEqual(['z-01', 'z-02', 'z-03']);
    expect([...zones.values()].map(isAerialZone)).toEqual([false, false, true]);
  });

  it('어느 축이든 폭이 0 이하이면 null', () => {
    expect(zoneBox({ min: worldPoint(0, 0, 1), max: worldPoint(1, 1, 1) })).toBeNull();
    expect(zoneBox({ min: worldPoint(0, 0, 0), max: worldPoint(0, 1, 1) })).toBeNull();
    expect(zoneBox({ min: worldPoint(2, 0, 0), max: worldPoint(1, 1, 1) })).toBeNull();
  });

  it('모서리는 12개 축 정렬 선분이고 길이가 상자 크기와 같다', () => {
    const size = [2, 1.2, 1.5];
    const points = boxEdges(size);
    expect(points).toHaveLength(24);
    const lengths = { 0: 0, 1: 0, 2: 0 } as Record<number, number>;
    for (let i = 0; i < points.length; i += 2) {
      const [a, b] = [points[i]!, points[i + 1]!];
      const axes = [0, 1, 2].filter((k) => a[k] !== b[k]);
      expect(axes).toHaveLength(1);
      expect(Math.abs(b[axes[0]!]! - a[axes[0]!]!)).toBeCloseTo(size[axes[0]!]!);
      lengths[axes[0]!]! += 1;
      for (const p of [a, b]) p.forEach((v, k) => expect(Math.abs(v)).toBeCloseTo(size[k]! / 2));
    }
    expect(lengths).toEqual({ 0: 4, 1: 4, 2: 4 });
  });

  it('공중 구역 안내선은 하단 모서리에서 바닥(World Z=0) 바로 위까지 내린다', () => {
    const z3 = zoneBox(zonesById().get('z-03')!)!;
    const points = aerialGuides(z3.size, z3.position[1]);
    expect(points).toHaveLength(16);
    const ys = new Set(points.map((p) => Math.round((p[1] + z3.position[1]) * 1e9) / 1e9));
    // 장면 기준 높이: 바닥 표시(0.01)와 구역 하단(1.2)만 나온다.
    expect([...ys].sort()).toEqual([FLOOR_GUIDE_LIFT, 1.2]);
  });
});

describe('DEMO 다각형 → AABB 판정', () => {
  const rect = [
    [1.5, 5.5],
    [4.5, 5.5],
    [4.5, 8.5],
    [1.5, 8.5],
  ];

  it('축 정렬 직사각형 4점 + 높이는 정확한 AABB 가 된다(순서·방향 무관)', () => {
    expect(rectangleToAabb(rect, 0, 2)).toEqual({
      ok: true,
      min: [1.5, 5.5, 0],
      max: [4.5, 8.5, 2],
    });
    const reversed = [...rect].reverse();
    expect(rectangleToAabb(reversed, 1.2, 2.4)).toEqual({
      ok: true,
      min: [1.5, 5.5, 1.2],
      max: [4.5, 8.5, 2.4],
    });
    const rotatedStart = [...rect.slice(2), ...rect.slice(0, 2)];
    expect(rectangleToAabb(rotatedStart, 0, 1).ok).toBe(true);
  });

  it.each([
    [
      '회전한 사각형(마름모)',
      [
        [3, 0],
        [6, 3],
        [3, 6],
        [0, 3],
      ],
      0,
      2,
      'NOT_AXIS_ALIGNED_RECTANGLE',
    ],
    [
      '조금 기운 사각형',
      [
        [0, 0],
        [4, 0.01],
        [4, 3],
        [0, 3],
      ],
      0,
      2,
      'NOT_AXIS_ALIGNED_RECTANGLE',
    ],
    [
      '꼬인 순서',
      [
        [0, 0],
        [4, 3],
        [4, 0],
        [0, 3],
      ],
      0,
      2,
      'NOT_AXIS_ALIGNED_RECTANGLE',
    ],
    [
      '중복 꼭짓점',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [4, 3],
      ],
      0,
      2,
      'NOT_AXIS_ALIGNED_RECTANGLE',
    ],
    [
      '비정형 사각형',
      [
        [0, 0],
        [4, 0],
        [5, 3],
        [0, 3],
      ],
      0,
      2,
      'NOT_AXIS_ALIGNED_RECTANGLE',
    ],
    [
      '삼각형',
      [
        [0, 0],
        [4, 0],
        [0, 3],
      ],
      0,
      2,
      'NOT_FOUR_VERTICES',
    ],
    [
      '오각형',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [2, 4],
        [0, 3],
      ],
      0,
      2,
      'NOT_FOUR_VERTICES',
    ],
    [
      '한 줄',
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ],
      0,
      2,
      'EMPTY_AREA',
    ],
    [
      'NaN 좌표',
      [
        [0, 0],
        [Number.NaN, 0],
        [4, 3],
        [0, 3],
      ],
      0,
      2,
      'INVALID_NUMBER',
    ],
    [
      '3차원 꼭짓점',
      [
        [0, 0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      0,
      2,
      'INVALID_NUMBER',
    ],
    [
      '높이 미상',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      null,
      2,
      'HEIGHT_UNKNOWN',
    ],
    [
      '높이 0',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      1,
      1,
      'EMPTY_HEIGHT',
    ],
    [
      '뒤집힌 높이',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      2,
      1,
      'EMPTY_HEIGHT',
    ],
    [
      '무한 높이',
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      0,
      Number.POSITIVE_INFINITY,
      'INVALID_NUMBER',
    ],
  ])('%s 는 AABB 로 넓히거나 줄이지 않고 거부한다', (_, vertices, zMin, zMax, reason) => {
    expect(rectangleToAabb(vertices, zMin, zMax)).toEqual({ ok: false, reason });
  });
});

describe('구역 표시 규칙', () => {
  it('적용 미확인·미리보기·적용 가정은 선 모양·색·투명도·문구가 모두 다르다', () => {
    const [unverified, preview, applied] = ZONE_APPLY_STATES.map((s) => zoneStyle(s, false));
    expect([unverified!.dashed, preview!.dashed, applied!.dashed]).toEqual([true, true, false]);
    expect(unverified!.dashSize).not.toBe(preview!.dashSize);
    expect(unverified!.color).not.toBe(preview!.color);
    expect(new Set([unverified, preview, applied].map((s) => s!.fillOpacity)).size).toBe(3);
    expect(new Set([unverified, preview, applied].map((s) => s!.stateLabel)).size).toBe(3);
  });

  it('어느 문구도 실제 적용 확정으로 읽히지 않는다', () => {
    for (const state of ZONE_APPLY_STATES) {
      expect(zoneStyle(state, false).stateLabel).toMatch(/미확인|DEMO/);
    }
  });

  it('선택은 색과 선 모양(적용 상태)을 바꾸지 않고 채움과 선을 짙게 한다', () => {
    for (const state of ZONE_APPLY_STATES) {
      const [off, on] = [zoneStyle(state, false), zoneStyle(state, true)];
      expect([on.color, on.dashed, on.dashSize, on.stateLabel]).toEqual([
        off.color,
        off.dashed,
        off.dashSize,
        off.stateLabel,
      ]);
      expect(on.fillOpacity).toBeGreaterThan(off.fillOpacity);
      expect(on.edgeOpacity).toBe(1);
    }
  });

  it.each(['dark', 'light'] as const)(
    '%s: 구역 색은 심각도 색이고, 안내이거나 모르면 청록, 미리보기는 보라다',
    (theme) => {
      const palette = PALETTE[theme];
      const color = (severity?: ZoneSeverity) =>
        zoneStyle('UNVERIFIED', false, palette, severity).color;
      expect(color('CRITICAL')).toBe(palette.risk.CRITICAL.color);
      expect(color('HIGH')).toBe(palette.risk.HIGH.color);
      expect(color('CAUTION')).toBe(palette.risk.CAUTION.color);
      expect(color('INFO')).toBe(palette.zone.color);
      expect(color()).toBe(palette.zone.color);
      expect(zoneStyle('DEMO_PREVIEW', false, palette, 'CRITICAL').color).toBe(
        palette.zone.preview,
      );
    },
  );

  it('가려진 부분의 선은 보이는 선보다 흐리지만 보인다', () => {
    for (const state of ZONE_APPLY_STATES) {
      for (const selected of [false, true]) {
        const style = zoneStyle(state, selected);
        expect(style.hiddenEdgeOpacity).toBeGreaterThan(0);
        expect(style.hiddenEdgeOpacity).toBeLessThan(style.edgeOpacity);
      }
    }
  });

  it('구역 심각도는 정식 구역은 official, DEMO 구역은 알려 준 값이고 모르면 없다', () => {
    const base: ZoneView = {
      zoneId: 'z',
      name: 'z',
      min: worldPoint(0, 0, 0),
      max: worldPoint(1, 1, 1),
    };
    const official = {
      zoneVersion: 1,
      evalType: 'VOLUME_3D' as const,
      severity: 'HIGH' as const,
      zoneKind: null,
      polygonXy: [],
      zRange: null,
      hasGuardrail: null,
      validFrom: null,
    };
    expect(zoneSeverity({ ...base, official })).toBe('HIGH');
    expect(zoneSeverity({ ...base, severity: 'CRITICAL' })).toBe('CRITICAL');
    expect(zoneSeverity(base)).toBeUndefined();
  });

  it('이름표는 구역 이름만 적고, 이름이 비면 `구역`이다', () => {
    expect(zoneLabel(zonesById().get('z-03')!)).toBe('예시 구역 C(공중)');
    expect(zoneLabel({ name: '  단상  ' })).toBe('단상');
    expect(zoneLabel({ name: '   ' })).toBe('구역');
    expect(zoneLabel({ name: '' })).toBe('구역');
  });

  it('광선에 사람이 있으면 가장 가까운 사람을 고르고, 없으면 null 이다', () => {
    const hit = (name: string) => ({ eventObject: { name } });
    expect(personOnRay([hit('zone:z-01'), hit('person:w-0001'), hit('person:w-0002')])).toEqual({
      type: 'person',
      id: 'w-0001',
    });
    expect(personOnRay([hit('zone:z-01')])).toBeNull();
    expect(personOnRay([hit('zone:z-01'), hit('object:surface1'), hit('person-layer')])).toBeNull();
  });
});

describe('확인 전 구역 표시(S15P31A101-629)', () => {
  it('확인 필요 구역은 같은 색으로 채움을 옅게, 윤곽을 흐린 점선으로 그리고 이름표에 확인 필요를 붙인다', () => {
    const normal = zoneStyle('UNVERIFIED', false, PALETTE.dark, 'HIGH');
    const review = zoneStyle('UNVERIFIED', false, PALETTE.dark, 'HIGH', true);
    expect(review.color).toBe(normal.color);
    expect(review.fillOpacity).toBeLessThan(normal.fillOpacity);
    expect(review.edgeOpacity).toBeLessThan(normal.edgeOpacity);
    expect(review.dashed).toBe(true);
    expect(review.dashSize).toBeLessThan(normal.dashSize);
    expect(review.stateLabel).toBe('확인 필요');
    expect(zoneStyle('UNVERIFIED', true, PALETTE.dark, 'HIGH', true).edgeOpacity).toBe(1);
    expect(zoneLabel({ name: '개구부', needsReview: true })).toBe('개구부 · 확인 필요');
    expect(zoneLabel({ name: '개구부' })).toBe('개구부');
  });
});

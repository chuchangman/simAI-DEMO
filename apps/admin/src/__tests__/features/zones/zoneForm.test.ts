import type { Zone } from '@/features/zones/types';
import { defaultNewBox } from '@/features/zones/zoneEditModel';
import {
  bodyOf,
  DUPLICATE_NAME_ERROR,
  formErrors,
  formOf,
  NAME_INPUT_MAX,
  NAME_MAX,
  nameError,
  newZoneBodyOf,
  newZoneErrors,
  shapeOfBox,
  type ZoneForm,
} from '@/features/zones/zoneForm';
import { DEFAULT_ROOM_LIMIT } from '@/lib/roomLimit';
import { describe, expect, it } from 'vitest';

/** 유형을 아직 고르지 않은 새 구역 양식. */
const NEW_ZONE_FORM: ZoneForm = {
  name: '새 구역',
  judgeType: 'VOLUME_3D',
  zoneType: '',
  severity: 'HIGH',
};

const ZONE: Zone = {
  zoneId: 'z-04',
  name: '개구부 위',
  min: [0, 0, 0],
  max: [2, 3, 1],
  version: 2,
  judgeType: 'VOLUME_3D',
  zoneType: 'OPENING',
  severity: 'CRITICAL',
  polygon: [
    [0, 0],
    [2, 0],
    [2, 3],
    [0, 3],
  ],
  zBounds: [0, 1],
  zRange: [0, 1],
  hasGuardrail: true,
  requirements: { helmet: true },
  validFrom: 100,
  workId: null,
  layoutId: null,
  layoutItemId: null,
  shapeEditable: true,
};

describe('nameError', () => {
  it('비었거나 공백뿐이면 입력하라고, 고친 이름이 40자를 넘으면 길이 제한을 알린다', () => {
    expect(nameError('', '개구부')).toBe('이름을 입력하세요.');
    expect(nameError('   ', '개구부')).toBe('이름을 입력하세요.');
    expect(nameError('ㄱ'.repeat(41), '개구부')).toBe(`이름은 ${NAME_MAX}자까지입니다.`);
    expect(nameError(` ${'ㄱ'.repeat(40)} `, '개구부')).toBeUndefined();
  });

  it('받은 이름이 이미 길면 그 이름은 그대로 저장할 수 있다', () => {
    const saved = 'ㄱ'.repeat(50);
    expect(nameError(saved, saved)).toBeUndefined();
    expect(nameError(`${saved} `, saved)).toBeUndefined();
    expect(nameError('ㄴ'.repeat(41), saved)).toBeDefined();
  });

  it('입력 칸은 검사 한도보다 조금 더 받는다', () => {
    expect(NAME_INPUT_MAX).toBeGreaterThan(NAME_MAX);
  });
});

describe('zoneForm', () => {
  it('이름은 비우거나 40자를 넘길 수 없다', () => {
    const form = formOf(ZONE);
    const check = (next: ZoneForm) => formErrors(next, { saved: form, hasHeight: true });
    expect(check(form)).toEqual({});
    expect(check({ ...form, name: '  ' }).name).toBeDefined();
    expect(check({ ...form, name: 'ㄱ'.repeat(41) }).name).toBeDefined();
    expect(check({ ...form, name: ` ${'ㄱ'.repeat(40)} ` }).name).toBeUndefined();
  });

  it('받은 이름이 이미 길면 그 이름을 그대로 둔 채 다른 칸을 저장할 수 있다(길이는 고친 이름만 본다)', () => {
    const saved = { ...formOf(ZONE), name: 'ㄱ'.repeat(50) };
    expect(formErrors({ ...saved, severity: 'HIGH' }, { saved, hasHeight: true })).toEqual({});
    expect(
      formErrors({ ...saved, name: 'ㄴ'.repeat(41) }, { saved, hasHeight: true }).name,
    ).toBeDefined();
  });

  it('높이가 없는 구역은 입체(VOLUME_3D)로 판정할 수 없다(서버 INVALID_Z_RANGE)', () => {
    const saved = { ...formOf(ZONE), judgeType: 'GROUND_FOOTPRINT' as const };
    const volume = { ...saved, judgeType: 'VOLUME_3D' as const };
    expect(formErrors(volume, { saved, hasHeight: false }).judgeType).toBeDefined();
    expect(formErrors(volume, { saved, hasHeight: true }).judgeType).toBeUndefined();
    expect(formErrors(saved, { saved, hasHeight: false })).toEqual({});
  });

  it('심각도는 위험·경고만 고를 수 있고, 이미 저장된 주의·안내는 다시 골라야 저장한다', () => {
    const saved = formOf(ZONE);
    const check = (severity: ZoneForm['severity']) =>
      formErrors({ ...saved, severity }, { saved, hasHeight: true }).severity;
    expect(check('CRITICAL')).toBeUndefined();
    expect(check('HIGH')).toBeUndefined();
    expect(check('CAUTION')).toBeDefined();
    expect(check('INFO')).toBeDefined();
    expect(newZoneErrors(NEW_ZONE_FORM).severity).toBeUndefined();
  });

  it('새 모양을 정했으면 그 모양을 서버 형식(eval_type·zone_kind·z_min_m·z_max_m)으로 보내고, 고치지 않는 칸은 받은 값을 그대로 보낸다', () => {
    const form = { ...formOf(ZONE), name: ' 새 이름 ', zoneType: 'LIFTING' };
    expect(bodyOf(ZONE, form, shapeOfBox({ min: [1, 1, 0.5], max: [4, 2, 3] }))).toEqual({
      name: '새 이름',
      zone_kind: 'LIFTING',
      eval_type: 'VOLUME_3D',
      polygon_xy: [
        [1, 1],
        [4, 1],
        [4, 2],
        [1, 2],
      ],
      z_min_m: 0.5,
      z_max_m: 3,
      severity: 'CRITICAL',
      has_guardrail: true,
      requirements: { helmet: true },
    });
  });

  it('이름을 고치지 않았으면 받은 이름(공백 포함)을 그대로 보낸다', () => {
    const zone = { ...ZONE, name: '개구부 위 ' };
    expect(bodyOf(zone, { ...formOf(zone), severity: 'HIGH' }, null).name).toBe('개구부 위 ');
  });

  it('직사각형이 아니거나 높이가 없는 구역은 속성만 저장해도 받은 다각형과 빈 높이를 그대로 보낸다', () => {
    const triangle: Zone = {
      ...ZONE,
      judgeType: 'GROUND_FOOTPRINT',
      polygon: [
        [0, 0],
        [4, 0],
        [0, 3],
      ],
      zBounds: [null, null],
      zRange: null,
      hasGuardrail: null,
      requirements: null,
      shapeEditable: false,
    };
    const body = bodyOf(triangle, { ...formOf(triangle), name: '삼각 구역' }, null);
    expect(body).toMatchObject({
      polygon_xy: [
        [0, 0],
        [4, 0],
        [0, 3],
      ],
      z_min_m: null,
      z_max_m: null,
      has_guardrail: null,
      requirements: null,
    });
  });

  it('높이가 한쪽만 있는 구역은 속성만 저장해도 그 높이를 지우지 않는다', () => {
    const half: Zone = {
      ...ZONE,
      judgeType: 'GROUND_FOOTPRINT',
      zBounds: [0.5, null],
      zRange: null,
      shapeEditable: false,
    };
    expect(bodyOf(half, { ...formOf(half), severity: 'HIGH' }, null)).toMatchObject({
      z_min_m: 0.5,
      z_max_m: null,
    });
  });

  it('새 구역은 기존 구역들의 가운데 바닥에 2×2 m, 높이 2 m 로 고른 유형으로 만든다', () => {
    const body = newZoneBodyOf(
      { ...NEW_ZONE_FORM, zoneType: 'LIFTING' },
      shapeOfBox(
        defaultNewBox([ZONE, { ...ZONE, min: [6, 7, 0], max: [8, 9, 1] }], DEFAULT_ROOM_LIMIT),
      ),
    );
    expect(body.polygon_xy).toEqual([
      [3, 3.5],
      [5, 3.5],
      [5, 5.5],
      [3, 5.5],
    ]);
    expect(body).toMatchObject({ zone_kind: 'LIFTING', z_min_m: 0, z_max_m: 2 });
  });
});

describe('이름 겹침(S15P31A101-651)', () => {
  const taken = new Set(['개구부 1', '고소작업면 A']);

  it('다른 활성 구역과 같은 이름으로 고치면 막고, 받은 이름 그대로면 겹쳐도 막지 않는다', () => {
    expect(nameError(' 개구부 1 ', '단상', taken)).toBe(DUPLICATE_NAME_ERROR);
    expect(nameError('개구부 2', '단상', taken)).toBeUndefined();
    // 예전에 겹친 이름으로 저장된 구역은 이름을 안 고쳤으면 다른 칸 저장을 막지 않는다.
    expect(nameError('개구부 1', '개구부 1', taken)).toBeUndefined();
  });

  it('새 구역 양식도 겹친 이름을 막는다', () => {
    const form = { ...NEW_ZONE_FORM, zoneType: 'LIFTING', name: '고소작업면 A' };
    expect(newZoneErrors(form, taken).name).toBe(DUPLICATE_NAME_ERROR);
    expect(newZoneErrors(form).name).toBeUndefined();
  });
});

describe('새 구역 양식', () => {
  it('유형을 고르기 전에는 만들 수 없고, 이름 규칙은 저장과 같다', () => {
    expect(newZoneErrors(NEW_ZONE_FORM)).toEqual({ zoneType: '유형을 고르세요.' });
    expect(newZoneErrors({ ...NEW_ZONE_FORM, zoneType: 'LIFTING' })).toEqual({});
    expect(newZoneErrors({ ...NEW_ZONE_FORM, zoneType: 'LIFTING', name: ' ' }).name).toBe(
      '이름을 입력하세요.',
    );
  });

  it('처음 상자는 기존 구역들 가운데 바닥의 2×2×2m 이고, 본문은 양식 값과 상자를 그대로 싣는다', () => {
    const zones = [ZONE, { ...ZONE, min: [6, 7, 0] as const, max: [8, 9, 1] as const }];
    const box = defaultNewBox(zones, DEFAULT_ROOM_LIMIT);
    expect(box.max[0] - box.min[0]).toBe(2);
    expect(box.max[2]).toBe(2);
    const body = newZoneBodyOf(
      { ...NEW_ZONE_FORM, zoneType: 'LIFTING', severity: 'CRITICAL' },
      shapeOfBox(box),
    );
    expect(body).toMatchObject({
      name: '새 구역',
      zone_kind: 'LIFTING',
      eval_type: 'VOLUME_3D',
      severity: 'CRITICAL',
      z_min_m: box.min[2],
      z_max_m: box.max[2],
    });
  });
});

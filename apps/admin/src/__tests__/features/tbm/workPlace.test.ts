import { storedPlaceOf, workPlaceLabel } from '@/features/tbm/workPlace';
import { describe, expect, it } from 'vitest';

describe('작업 장소 글자', () => {
  it('구역 작업은 서버가 채운 구역 이름을 쓰고, 비었으면 번호 대신 `구역` 이다', () => {
    expect(workPlaceLabel({ zone_id: 'z-1a2b3c4d', place: ' 개구부 구역 ' })).toBe('개구부 구역');
    expect(workPlaceLabel({ zone_id: 'z-1a2b3c4d', place: null })).toBe('구역');
    expect(workPlaceLabel({ zone_id: 'z-1a2b3c4d' })).toBe('구역');
  });

  it('구역 없는 작업은 적은 장소, 없으면 현장 전체이고 예전 자동 문구 `구역 밖`도 현장 전체다', () => {
    expect(workPlaceLabel({ zone_id: null, place: '북서쪽 바닥' })).toBe('북서쪽 바닥');
    expect(workPlaceLabel({ zone_id: null, place: null })).toBe('현장 전체');
    expect(workPlaceLabel({ zone_id: null, place: '  ' })).toBe('현장 전체');
    expect(workPlaceLabel({ zone_id: null, place: '구역 밖' })).toBe('현장 전체');
  });

  it('다시 저장할 장소는 구역 없는 작업이 적어 둔 장소뿐이다', () => {
    expect(storedPlaceOf({ zone: null, area: '북서쪽 바닥' })).toBe('북서쪽 바닥');
    expect(storedPlaceOf({ zone: null, area: '현장 전체' })).toBeNull();
    expect(storedPlaceOf({ zone: null })).toBeNull();
    expect(storedPlaceOf({ zone: 'z-04', area: '개구부 구역' })).toBeNull();
  });
});

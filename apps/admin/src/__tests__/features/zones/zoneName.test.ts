import { zoneNameOf, zoneNameOrDefault } from '@/features/zones/zoneName';
import { describe, expect, it } from 'vitest';

describe('zoneNameOf', () => {
  const nameOf = zoneNameOf([
    { zoneId: 'z-04', name: ' 개구부 구역 ' },
    { zoneId: 'z-02', name: ' ' },
  ]);

  it('구역 ID 로 앞뒤 공백을 뗀 이름을 찾는다', () => {
    expect(nameOf('z-04')).toBe('개구부 구역');
  });

  it('이름이 빈 구역은 null 이다(`구역` 으로 바꾸는 것은 주어 자리만 한다)', () => {
    expect(nameOf('z-02')).toBeNull();
  });

  it('목록에 없는 구역은 null 이다(이름을 지어내지 않는다)', () => {
    expect(nameOf('z-99')).toBeNull();
    expect(zoneNameOf([])('z-04')).toBeNull();
  });

  it('구역 ID 가 없거나 비어 있어도 null 을 돌려준다', () => {
    expect(nameOf(null)).toBeNull();
    expect(nameOf(undefined)).toBeNull();
    expect(nameOf('')).toBeNull();
  });
});

describe('zoneNameOrDefault', () => {
  const nameOf = zoneNameOf([
    { zoneId: 'z-04', name: '개구부 구역' },
    { zoneId: 'z-02', name: '' },
  ]);

  it('이름을 알면 그 이름, 모르거나 비었으면 `구역` 이다', () => {
    expect(zoneNameOrDefault('z-04', nameOf)).toBe('개구부 구역');
    expect(zoneNameOrDefault('z-02', nameOf)).toBe('구역');
    expect(zoneNameOrDefault('z-99', nameOf)).toBe('구역');
  });
});

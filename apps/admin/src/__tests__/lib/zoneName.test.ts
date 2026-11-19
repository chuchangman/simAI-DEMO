import { zoneDisplayName } from '@/lib/zoneName';
import { describe, expect, it } from 'vitest';

describe('zoneDisplayName', () => {
  it('이름이 있으면 앞뒤 공백만 떼어 그대로 보인다', () => {
    expect(zoneDisplayName('개구부 구역')).toBe('개구부 구역');
    expect(zoneDisplayName('  단상 구역 ')).toBe('단상 구역');
  });

  it('비었거나 공백뿐이면 `구역` 이다', () => {
    expect(zoneDisplayName('')).toBe('구역');
    expect(zoneDisplayName('   ')).toBe('구역');
  });
});

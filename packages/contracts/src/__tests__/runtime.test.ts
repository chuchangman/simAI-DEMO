import { describe, expect, it } from 'vitest';
import { equal, ucs2length } from '../runtime';

describe('equal', () => {
  it('JSON 값을 깊게 비교한다', () => {
    expect(equal({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true);
    expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(equal({ a: 1 }, { b: 1 })).toBe(false);
    expect(equal([1, 2], [2, 1])).toBe(false);
    expect(equal([[1]], [[1]])).toBe(true);
    expect(equal([], {})).toBe(false);
    expect(equal(null, {})).toBe(false);
    expect(equal(null, null)).toBe(true);
    expect(equal(Number.NaN, Number.NaN)).toBe(true);
  });
});

describe('ucs2length', () => {
  it('서로게이트 쌍을 한 글자로 센다', () => {
    expect(ucs2length('')).toBe(0);
    expect(ucs2length('관제')).toBe(2);
    expect(ucs2length('a😀')).toBe(2);
  });

  it('짝이 없는 서로게이트도 한 글자로 센다(ajv 와 같음)', () => {
    expect(ucs2length('\ud800')).toBe(1);
    expect(ucs2length('\ud800a')).toBe(2);
    expect(ucs2length('\udc00')).toBe(1);
  });
});

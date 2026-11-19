import { createSafeStorage } from '@/lib/safeStorage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'simai.test.safe';

describe('createSafeStorage', () => {
  const storage = createSafeStorage<{ n: number }>();

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('값을 JSON 으로 남기고 다시 읽는다', () => {
    storage.setItem(KEY, { state: { n: 1 }, version: 0 });
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ state: { n: 1 }, version: 0 });
    expect(storage.getItem(KEY)).toEqual({ state: { n: 1 }, version: 0 });
  });

  it('남은 값이 없으면 null 이다', () => {
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('남은 값이 JSON 이 아니면 에러 없이 null 이다', () => {
    localStorage.setItem(KEY, '{not json');
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('브라우저가 읽기를 막아도 에러 없이 null 이다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('저장할 수 없어도(용량 초과) 에러를 내지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => storage.setItem(KEY, { state: { n: 1 }, version: 0 })).not.toThrow();
  });

  it('지운다. 지울 수 없어도 에러를 내지 않는다', () => {
    storage.setItem(KEY, { state: { n: 1 }, version: 0 });
    storage.removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();

    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => storage.removeItem(KEY)).not.toThrow();
  });
});

import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * zustand persist 가 쓰는 localStorage 저장소. 값은 JSON 으로 남긴다.
 * 저장할 수 없는 환경(사생활 보호 창, 용량 초과)이거나 남은 값이 깨졌으면 에러 없이 메모리에만 둔다.
 */
export function createSafeStorage<T>(): PersistStorage<T> {
  return {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<T>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, JSON.stringify(value));
      } catch {
        // 메모리에만 둔다.
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        // 지우지 못해도 화면 상태는 그대로다.
      }
    },
  };
}

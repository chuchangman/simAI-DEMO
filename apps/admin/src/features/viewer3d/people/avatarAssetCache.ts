// 아바타 메시·외형 자산의 공용 캐시 수명(-797). 쓰는 화면이 없어진 뒤에도 잠시 남겨 두어,
// 작업 시작으로 /work → /live 를 넘어가며 3D 가 다시 마운트되어도 같은 자산을 다시 받지 않는다.

/** 마지막 사용자가 놓은 뒤 자원을 해제하기까지(ms). 화면 전환(작업 시작 확인 화면에 머무는 시간)을 넉넉히 넘긴다. */
export const AVATAR_ASSET_RELEASE_MS = 120_000;
/** 아무도 쓰지 않고 해제를 기다리는 항목을 이만큼만 남긴다. 넘치면 가장 오래 놓인 것부터 바로 해제한다(쓰는 항목은 빼지 않는다). */
export const AVATAR_ASSET_MAX_UNREFERENCED = 8;

export interface AvatarCacheEntry {
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** 마지막으로 놓인 순서. 해제를 기다리는 항목 가운데 작을수록 오래 놓였다. */
  idleSeq: number;
}

export interface AvatarAssetCache<E extends AvatarCacheEntry> {
  readonly map: Map<string, E>;
  retain(key: string): void;
  release(key: string): void;
  /** 시험용: 모든 항목을 해제하고 비운다. */
  clear(): void;
}

/** key 별 참조 수를 세고, 참조가 0 이 되면 AVATAR_ASSET_RELEASE_MS 뒤(또는 상한을 넘으면 바로) 지우고 dispose 를 부른다. */
export function createAvatarAssetCache<E extends AvatarCacheEntry>(
  dispose: (entry: E) => void,
): AvatarAssetCache<E> {
  const map = new Map<string, E>();
  let seq = 0;

  const evict = (key: string, entry: E) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    if (map.get(key) === entry) map.delete(key);
    dispose(entry);
  };

  const trimUnreferenced = () => {
    const idle = [...map].filter(([, e]) => e.refs === 0 && e.timer !== null);
    if (idle.length <= AVATAR_ASSET_MAX_UNREFERENCED) return;
    idle.sort((a, b) => a[1].idleSeq - b[1].idleSeq);
    for (const [key, entry] of idle.slice(0, idle.length - AVATAR_ASSET_MAX_UNREFERENCED)) {
      evict(key, entry);
    }
  };

  return {
    map,
    retain(key) {
      const entry = map.get(key);
      if (!entry) return;
      entry.refs += 1;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
    },
    release(key) {
      const entry = map.get(key);
      if (!entry) return;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs > 0) return;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.idleSeq = seq++;
      entry.timer = setTimeout(() => {
        if (map.get(key) !== entry || entry.refs > 0) return;
        evict(key, entry);
      }, AVATAR_ASSET_RELEASE_MS);
      trimUnreferenced();
    },
    clear() {
      for (const [key, entry] of [...map]) evict(key, entry);
      map.clear();
    },
  };
}

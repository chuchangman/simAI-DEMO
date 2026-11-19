import { loadCachedScene } from '@/features/viewer3d/scene/sceneAssetCache';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Scene 자산 캐시', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('브라우저 캐시를 열 수 없어도 네트워크에서 읽는다', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('unavailable')) });
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await loadCachedScene(
        'https://assets.example/map.glb?signature=x',
        'v1',
        async (bytes) => bytes.byteLength,
      ),
    ).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('서명 주소가 바뀌어도 같은 버전은 재사용하고, 새 버전은 다시 받는다', async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: async (key: string) => entries.get(key)?.clone(),
      put: async (key: string, value: Response) => {
        entries.set(key, value.clone());
      },
      keys: async () => [...entries.keys()].map((key) => new Request(key)),
      delete: async (key: string | Request) =>
        entries.delete(typeof key === 'string' ? key : key.url),
    };
    vi.stubGlobal('caches', { open: async () => cache });
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    const parse = async (bytes: ArrayBuffer) => bytes.byteLength;
    const url = 'https://assets.example/map.glb?signature=first';
    expect(await loadCachedScene(url, 'v1', parse)).toBe(3);
    expect(
      await loadCachedScene('https://assets.example/map.glb?signature=second', 'v1', parse),
    ).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await loadCachedScene(url, 'v2', parse)).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(1);
    expect([...entries.keys()][0]).not.toContain('signature');
  });
});

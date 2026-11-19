// 서명 URL 은 요청마다 달라진다. 인증된 현재 Scene 버전과 자산 경로로 GLB 를 재사용한다.
// 화면에서 받은 영상이나 서명 URL 은 저장하지 않는다. 저장 공간이 없으면 네트워크로만 동작한다.
const CACHE_NAME = 'simai-scene-assets-v1';
const MAX_BYTES = 100 * 1024 * 1024;

export async function loadCachedScene<T>(
  url: string,
  version: string,
  parse: (bytes: ArrayBuffer) => Promise<T>,
): Promise<T> {
  const asset = new URL(url, window.location.href);
  const key = new URL('/__simai_scene_cache__', window.location.origin);
  key.searchParams.set('version', version);
  key.searchParams.set('asset', `${asset.origin}${asset.pathname}`);
  let cache: Cache | undefined;
  try {
    cache = await globalThis.caches?.open(CACHE_NAME);
    const cached = await cache?.match(key.href);
    if (cached) {
      try {
        return await parse(await cached.arrayBuffer());
      } catch {
        await cache?.delete(key.href);
      }
    }
  } catch {
    cache = undefined;
  }

  const response = await fetch(url);
  if (!response.ok) throw { response: { status: response.status } };
  const bytes = await response.arrayBuffer();
  const result = await parse(bytes);
  if (cache && bytes.byteLength <= MAX_BYTES) {
    try {
      // 최신 자산 한 개만 유지해 현장 맵이 계속 쌓이지 않게 한다.
      for (const old of await cache.keys()) await cache.delete(old);
      await cache.put(key.href, new Response(bytes));
    } catch {
      // 캐시 쓰기 실패는 배경 표시를 막지 않는다.
    }
  }
  return result;
}

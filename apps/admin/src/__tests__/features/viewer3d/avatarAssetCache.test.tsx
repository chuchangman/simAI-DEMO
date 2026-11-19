import { adaptMessage } from '@/features/viewer3d/data/contractAdapter';
import {
  avatarSurfaceSourceUrl,
  avatarTextureUrl,
  getSyntheticAvatarPngPair,
  SYNTHETIC_MHR,
} from '@/features/viewer3d/dev-harness/avatarFixture';
import { avatarFrameMessage } from '@/features/viewer3d/dev-harness/scenarios';
import {
  acquireAvatarAppearance,
  avatarAppearanceKey,
  avatarAppearanceRequestOf,
  clearAvatarAppearanceCache,
  useAvatarAppearance,
} from '@/features/viewer3d/people/avatarAppearance';
import {
  AVATAR_ASSET_MAX_UNREFERENCED,
  AVATAR_ASSET_RELEASE_MS,
  createAvatarAssetCache,
  type AvatarCacheEntry,
} from '@/features/viewer3d/people/avatarAssetCache';
import type { AvatarPoseView } from '@/features/viewer3d/people/avatarFrame';
import {
  avatarAssetKey,
  clearAvatarMeshCache,
  useAvatarMesh,
} from '@/features/viewer3d/people/avatarMesh';
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BufferGeometry, Mesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// -797: 작업 시작(/work → /live)으로 3D 가 다시 마운트되어도 아바타 메시·외형을 다시 받지 않는다.
// 마지막 사용자가 놓은 뒤 AVATAR_ASSET_RELEASE_MS 동안 남기고, 놓인 항목은 AVATAR_ASSET_MAX_UNREFERENCED 개까지만 둔다.

const DIR = dirname(fileURLToPath(import.meta.url));
const GLB_BYTES = readFileSync(
  resolve(DIR, '../../../features/viewer3d/dev-harness/fixtures/synthetic-mhr.glb'),
);
const T0 = 1_710_000_000_000;
const copy = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;

/** 사람 worldId 의 appearance_version v 포즈(합성 GLB·PNG 주소). */
function avatarOf(worldId: string, version = 0): AvatarPoseView {
  const adapted = adaptMessage(avatarFrameMessage(0, T0)!, T0);
  if (adapted.kind !== 'avatar') throw new Error(adapted.kind);
  const base = adapted.frame.avatars[0]!;
  return {
    ...base,
    worldId,
    appearanceVersion: version,
    asset: {
      ...base.asset!,
      meshUrl: `/api/avatars/${worldId}/epochs/${T0}/versions/0/mesh.glb`,
      meshSha256: SYNTHETIC_MHR.meshSha256,
      jointCount: SYNTHETIC_MHR.jointCount,
      jointParentsSha256: SYNTHETIC_MHR.jointParentsSha256,
      pelvisJointIndex: SYNTHETIC_MHR.pelvisJointIndex,
      textureUrl: avatarTextureUrl(worldId, T0, version),
      surfaceSourceUrl: avatarSurfaceSourceUrl(worldId, T0, version),
    },
  };
}

function makeFetcher(fail: (url: string) => boolean = () => false) {
  const pair = getSyntheticAvatarPngPair('w-0001', 0, 16);
  return vi.fn(async (url: string) => {
    if (fail(url)) throw new Error('HTTP 503');
    if (url.endsWith('/mesh.glb')) return copy(GLB_BYTES);
    if (url.endsWith('/albedo.png')) return copy(pair.albedoPng);
    if (url.endsWith('/surface_source.png')) return copy(pair.surfaceSourcePng);
    throw new Error('HTTP 404');
  });
}

const callsTo = (fetcher: ReturnType<typeof makeFetcher>, suffix: string) =>
  fetcher.mock.calls.filter(([url]) => url.endsWith(suffix)).length;

function firstGeometry(scene: { traverse(fn: (node: unknown) => void): void }): BufferGeometry {
  let found: BufferGeometry | null = null;
  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!found && mesh.isMesh) found = mesh.geometry;
  });
  return found!;
}

afterEach(() => {
  clearAvatarMeshCache();
  clearAvatarAppearanceCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('공용 캐시 수명(createAvatarAssetCache)', () => {
  interface TestEntry extends AvatarCacheEntry {
    name: string;
  }
  let disposed: string[];
  let cache: ReturnType<typeof createAvatarAssetCache<TestEntry>>;
  const put = (name: string) => {
    cache.map.set(name, { name, refs: 0, timer: null, idleSeq: 0 });
    cache.retain(name);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    disposed = [];
    cache = createAvatarAssetCache<TestEntry>((e) => disposed.push(e.name));
  });

  it('놓은 뒤 해제 지연 안에 다시 쓰면 그대로 남고, 지연이 지나면 해제한다', () => {
    put('a');
    cache.release('a');
    vi.advanceTimersByTime(AVATAR_ASSET_RELEASE_MS - 1);
    expect(disposed).toEqual([]);
    cache.retain('a');
    vi.advanceTimersByTime(AVATAR_ASSET_RELEASE_MS * 2);
    expect(disposed).toEqual([]);
    cache.release('a');
    vi.advanceTimersByTime(AVATAR_ASSET_RELEASE_MS);
    expect(disposed).toEqual(['a']);
    expect(cache.map.has('a')).toBe(false);
  });

  it('놓인 항목이 상한을 넘으면 가장 오래 놓인 것부터 바로 해제하고, 쓰는 항목은 빼지 않는다', () => {
    put('held');
    const names = Array.from({ length: AVATAR_ASSET_MAX_UNREFERENCED + 2 }, (_, i) => `n${i}`);
    names.forEach(put);
    // n1 을 먼저 놓고 n0 을 나중에 놓는다: 놓인 순서(만든 순서 아님)로 뺀다.
    cache.release('n1');
    cache.release('n0');
    for (const name of names.slice(2)) cache.release(name);
    expect(disposed).toEqual(['n1', 'n0']);
    expect(cache.map.has('held')).toBe(true);
    expect([...cache.map.keys()].filter((k) => k !== 'held')).toHaveLength(
      AVATAR_ASSET_MAX_UNREFERENCED,
    );
    vi.advanceTimersByTime(AVATAR_ASSET_RELEASE_MS);
    expect(cache.map.has('held')).toBe(true);
    expect(disposed).not.toContain('held');
    expect(disposed).toHaveLength(names.length);
  });
});

describe('아바타 메시 캐시(useAvatarMesh)', () => {
  it('동시에 둘이 열면 한 번만 받고, 해제 지연 안에 다시 마운트하면 받지 않고 같은 메시를 쓰며, 지연이 지나면 해제한다', async () => {
    const fetcher = makeFetcher();
    const asset = avatarOf('w-0001').asset!;
    const key = avatarAssetKey(asset);
    const use = () => useAvatarMesh(key, () => asset, fetcher);

    const first = renderHook(use);
    const second = renderHook(use);
    await waitFor(() => expect(first.result.current.mesh).not.toBeNull(), { timeout: 5_000 });
    await waitFor(() => expect(second.result.current.mesh).not.toBeNull());
    expect(callsTo(fetcher, '/mesh.glb')).toBe(1);
    const mesh = first.result.current.mesh!;
    expect(second.result.current.mesh).toBe(mesh);

    const onDispose = vi.fn();
    firstGeometry(mesh.scene).addEventListener('dispose', onDispose);
    vi.useFakeTimers();
    first.unmount();
    second.unmount();

    // 작업 시작 확인 화면에 머무는 동안(해제 지연 안) 다시 마운트: 다시 받지 않고 바로 같은 메시다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RELEASE_MS - 1_000);
    });
    const again = renderHook(use);
    expect(again.result.current.mesh).toBe(mesh);
    expect(callsTo(fetcher, '/mesh.glb')).toBe(1);
    expect(onDispose).not.toHaveBeenCalled();

    again.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RELEASE_MS);
    });
    expect(onDispose).toHaveBeenCalled();
  });
});

describe('아바타 외형 캐시(useAvatarAppearance·acquireAvatarAppearance)', () => {
  it('동시에 둘이 열면 한 번만 받고, 해제 지연 안에 다시 마운트하면 받지 않고 같은 외형을 쓰며, 지연이 지나면 해제한다', async () => {
    const fetcher = makeFetcher();
    const avatar = avatarOf('w-0001', 3);
    const key = avatarAppearanceKey('w-0001', avatar);
    const use = () => useAvatarAppearance('w-0001', key, () => avatar, fetcher);

    const first = renderHook(use);
    const second = renderHook(use);
    await waitFor(() => expect(first.result.current.status).toBe('READY'), { timeout: 5_000 });
    await waitFor(() => expect(second.result.current.status).toBe('READY'));
    expect(callsTo(fetcher, '/albedo.png')).toBe(1);
    expect(callsTo(fetcher, '/surface_source.png')).toBe(1);
    const appearance = first.result.current.appearance!;
    expect(second.result.current.appearance).toBe(appearance);

    const onDispose = vi.fn();
    appearance.albedoTexture.addEventListener('dispose', onDispose);
    vi.useFakeTimers();
    first.unmount();
    second.unmount();
    expect(onDispose).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RELEASE_MS - 1_000);
    });
    const again = renderHook(use);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(again.result.current.status).toBe('READY');
    expect(again.result.current.appearance).toBe(appearance);
    expect(callsTo(fetcher, '/albedo.png')).toBe(1);
    expect(onDispose).not.toHaveBeenCalled();

    again.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AVATAR_ASSET_RELEASE_MS);
    });
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('놓인 외형이 상한을 넘으면 가장 오래 놓인 것부터 바로 해제하고, 쓰는 외형은 해제하지 않는다', async () => {
    const fetcher = makeFetcher();
    const requestOf = (worldId: string) => avatarAppearanceRequestOf(worldId, avatarOf(worldId))!;
    const held = acquireAvatarAppearance(requestOf('w-held'), fetcher);
    const leases = Array.from({ length: AVATAR_ASSET_MAX_UNREFERENCED + 1 }, (_, i) =>
      acquireAvatarAppearance(requestOf(`w-${i}`), fetcher),
    );
    const heldAppearance = await held.loaded;
    const loaded = await Promise.all(leases.map((l) => l.loaded));
    const disposedKeys: string[] = [];
    for (const a of [heldAppearance, ...loaded]) {
      a.albedoTexture.addEventListener('dispose', () => disposedKeys.push(a.worldId));
    }

    vi.useFakeTimers();
    for (const lease of leases) lease.release();
    expect(disposedKeys).toEqual(['w-0']);

    vi.advanceTimersByTime(AVATAR_ASSET_RELEASE_MS);
    expect(disposedKeys).toHaveLength(leases.length);
    expect(disposedKeys).not.toContain('w-held');

    // 쓰고 있던 외형은 그대로 남아 다시 빌려도 받지 않는다.
    const albedoCalls = callsTo(fetcher, '/albedo.png');
    const reuse = acquireAvatarAppearance(requestOf('w-held'), fetcher);
    expect(await reuse.loaded).toBe(heldAppearance);
    expect(callsTo(fetcher, '/albedo.png')).toBe(albedoCalls);
    reuse.release();
    held.release();
  });

  it('실패한 읽기는 캐시에 남기지 않아 다음 시도가 다시 받는다', async () => {
    let failing = true;
    const fetcher = makeFetcher((url) => failing && url.endsWith('/surface_source.png'));
    const req = avatarAppearanceRequestOf('w-0001', avatarOf('w-0001'))!;

    const failed = acquireAvatarAppearance(req, fetcher);
    await expect(failed.loaded).rejects.toThrow('HTTP 503');
    failed.release();

    failing = false;
    const retried = acquireAvatarAppearance(req, fetcher);
    const appearance = await retried.loaded;
    expect(appearance.worldId).toBe('w-0001');
    expect(callsTo(fetcher, '/surface_source.png')).toBe(2);
    retried.release();
  });
});

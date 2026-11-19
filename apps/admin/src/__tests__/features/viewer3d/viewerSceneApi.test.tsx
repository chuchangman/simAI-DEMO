import { Viewer3D, type ViewerSceneStatus } from '@/features/viewer3d';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 공개 입구의 배경 Scene 접점(-59). 기존 사용은 그대로이고, 넘긴 조회 결과에 대한 상태를 알린다.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const raw = {
  scene_version: 'scene-4',
  state: 'COMMITTED',
  default: false,
  calibration_version: 'cal-2',
  committed_at_ms: 1,
  quality: null,
  gltf_url: 'https://bucket.example/scene-4.glb?sig=secret',
  gltf_expires_at_ms: Date.now() + 300_000,
};

describe('Viewer3D 배경 Scene 접점(선택 사항)', () => {
  it('scene 없이도 그대로 쓰고 NONE 을 한 번 알린다', () => {
    const seen: ViewerSceneStatus[] = [];
    const { container } = render(<Viewer3D onSceneStatusChange={(s) => seen.push(s)} />);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(seen.map((s) => s.phase)).toEqual(['NONE']);
  });

  it('조회 결과를 바꿔 넘기면 상태를 알리고, 서명 주소는 상태에 싣지 않는다', () => {
    const seen: ViewerSceneStatus[] = [];
    const onChange = (s: ViewerSceneStatus) => seen.push(s);
    const { rerender } = render(
      <Viewer3D scene={{ ok: true, raw }} onSceneStatusChange={onChange} />,
    );
    expect(seen.at(-1)).toMatchObject({
      phase: 'LOADING',
      sceneVersion: 'scene-4',
      verification: 'UNCONFIRMED',
      display: 'HIDDEN',
    });
    expect(JSON.stringify(seen)).not.toContain('sig=secret');

    rerender(
      <Viewer3D
        scene={{ ok: false, reason: 'SCENE_NOT_FOUND', httpStatus: 404 }}
        onSceneStatusChange={onChange}
      />,
    );
    expect(seen.at(-1)).toMatchObject({ phase: 'UNAVAILABLE', reason: 'SCENE_NOT_FOUND' });

    rerender(<Viewer3D scene={null} onSceneStatusChange={onChange} />);
    expect(seen.at(-1)?.phase).toBe('NONE');
  });
});

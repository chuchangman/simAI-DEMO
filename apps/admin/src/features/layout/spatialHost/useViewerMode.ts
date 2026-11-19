import type { Viewer3DProps } from '@/features/viewer3d';
import { lazy, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';

export type ViewerModule = { default: ComponentType<Viewer3DProps> };

export type SpatialViewMode = '3d' | '2d';

// three.js 묶음은 3D 를 볼 때만 받는다. 받지 못하거나 3D 가 멈추면 2D 평면으로 바꾼다(명세 13.6 비상 화면).
export const importViewer = (): Promise<ViewerModule> =>
  import('@/features/viewer3d').then((viewer) => ({ default: viewer.Viewer3D }));

/**
 * 3D·2D 보기 전환과 3D 코드 받기. 3D 가 첫 화면을 그리기 전(코드를 받는 중·초기화 중·멈춤)에는
 * 화면에 들어와 planFallbackMs 가 지났거나 2D 를 보다가 3D 로 바꿨을 때만 2D 평면을 보인다(showPlan).
 */
export function useViewerMode(loadViewer: () => Promise<ViewerModule>, planFallbackMs: number) {
  const [view, setView] = useState<SpatialViewMode>('3d');
  const [loader, setLoader] = useState(() => ({ attempt: 0, Viewer3D: lazy(loadViewer) }));
  const loadFailed = useRef(false);
  const [viewerReady, setViewerReady] = useState(false);
  const [planBeforeReady, setPlanBeforeReady] = useState(false);

  useEffect(() => {
    if (view !== '3d' || viewerReady || planBeforeReady) return;
    const id = setTimeout(() => setPlanBeforeReady(true), planFallbackMs);
    return () => clearTimeout(id);
  }, [view, viewerReady, planBeforeReady, planFallbackMs]);

  const onViewerReady = useCallback(() => setViewerReady(true), []);
  const onViewerError = useCallback(() => setView('2d'), []);

  const onLoadError = useCallback(() => {
    loadFailed.current = true;
    setView('2d');
  }, []);

  const show3d = useCallback(() => {
    if (view === '3d') return;
    if (loadFailed.current) {
      loadFailed.current = false;
      setLoader((prev) => ({ attempt: prev.attempt + 1, Viewer3D: lazy(loadViewer) }));
    }
    setViewerReady(false);
    // 보던 2D 를 3D 가 준비될 때까지 그대로 둔다(그 사이 빈 화면을 두지 않는다).
    setPlanBeforeReady(true);
    setView('3d');
  }, [view, loadViewer]);

  return {
    view,
    viewerReady,
    showPlan: view === '2d' || (!viewerReady && planBeforeReady),
    Viewer3D: loader.Viewer3D,
    loadAttempt: loader.attempt,
    onViewerReady,
    onViewerError,
    onLoadError,
    show3d,
  };
}

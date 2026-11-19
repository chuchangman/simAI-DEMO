import { PLAN_FALLBACK_MS, ZONE_EDIT_LAYERS } from '@/features/layout/spatialHost/constants';
import { useBoxEditProps } from '@/features/layout/spatialHost/useBoxEditProps';
import { importViewer } from '@/features/layout/spatialHost/useViewerMode';
import { useViewportHost } from '@/features/layout/spatialHost/useViewportHost';
import { SpatialViewportContext } from '@/features/layout/SpatialViewportHost';
import { useThemeStore } from '@/features/layout/theme.store';
import { ViewerLoadBoundary } from '@/features/monitor/ViewerLoadBoundary';
import type { ExternalSpatialSource, ViewerBoxGhost } from '@/features/viewer3d';
import { Button } from '@simai/ui/components/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { cn } from '@simai/ui/lib/utils';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';

const SOURCE_ID = 'setup-zones';

const VIEW_BUTTON = 'bg-surface-3 px-3 hover:bg-surface-3/70';
const VIEW_BUTTON_ON = 'bg-primary text-primary-foreground hover:bg-primary-hover';

/**
 * 이 화면만 쓰는 3D 입력(구역·정적 객체만, 사람은 없다). 뷰어 코드를 받을 때 같이 만들어 세팅 앞 단계에서 three.js 를 받지
 * 않는다. 받지 못하면 null 로 두고 3D 칸이 2D 평면으로 바뀐다(ViewerLoadBoundary).
 */
function useZoneStepSource() {
  const [source, setSource] = useState<ExternalSpatialSource | null>(null);
  useEffect(() => {
    let alive = true;
    import('@/features/viewer3d')
      .then((viewer) => {
        if (alive) setSource(viewer.createExternalSource(SOURCE_ID));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return source;
}

/**
 * 세팅의 구역 단계: 왼쪽 큰 3D(세팅 맵 위 구역·작업면·장애물, 편집 상자 손잡이, AI 초안 점선 윤곽), 오른쪽 칸(구역 편집 패널·AI
 * 초안 목록). 관제 틀과 같은 공통 동작(useViewportHost)으로 3D 선택과 패널 선택을 맞춘다: 3D 에서 구역을 누르면 패널이 그 구역을
 * 열고, 패널에서 구역을 고르면 3D 가 그 구역으로 초점을 옮긴다. 3D 를 띄우지 못하면 plan(2D 평면)을 대신 보인다. 1·2단계처럼 남은 화면 높이를 꽉 채우고, 오른쪽 칸이 길면 그 칸 안에서만
 * 스크롤한다.
 */
export function SetupZoneStep({
  title,
  sceneVersion = null,
  draftGhosts,
  plan,
  children,
}: {
  title: string;
  /** 세팅 세션이 만든 Scene 버전. 있으면 그 버전을 /view 로 받아 그리고, 없으면(작업 전 확인 창 등) 지금 관제 Scene 을 그린다. */
  sceneVersion?: string | null;
  /** 아직 수락·버리기 전인 AI 구역 초안 윤곽. */
  draftGhosts: readonly ViewerBoxGhost[];
  plan: ReactNode;
  children: ReactNode;
}) {
  const theme = useThemeStore((s) => s.theme);
  const source = useZoneStepSource();
  const {
    viewer,
    scene,
    onSceneStatusChange,
    view,
    viewerReady,
    Viewer3D,
    loadAttempt,
    onLoadError,
    onViewerSelect,
    onViewerStatus,
    viewport,
  } = useViewportHost({
    source,
    loadViewer: importViewer,
    planFallbackMs: PLAN_FALLBACK_MS,
    sceneVersion,
  });
  const { boxEdit, boxGhosts, onBoxEditChange } = useBoxEditProps();
  const ghosts = useMemo(() => [...boxGhosts, ...draftGhosts], [boxGhosts, draftGhosts]);
  const [topView, setTopView] = useState(false);

  const resetView = () => {
    setTopView(false);
    viewer.current?.resetView?.();
  };

  return (
    <SpatialViewportContext value={viewport}>
      <div className="grid min-h-[420px] flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,420px)] grid-rows-[minmax(0,1fr)] gap-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              <h2>{title}</h2>
            </CardTitle>
            {view === '3d' && (
              <CardAction className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={topView}
                  onClick={() => setTopView(!topView)}
                  className={cn(VIEW_BUTTON, topView && VIEW_BUTTON_ON)}
                >
                  위에서 보기
                </Button>
                <Button size="sm" variant="secondary" onClick={resetView} className={VIEW_BUTTON}>
                  시점 초기화
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            {view === '3d' ? (
              <div
                data-testid="setup-zone-viewport"
                className="relative size-full overflow-hidden rounded-lg bg-background"
              >
                <ViewerLoadBoundary key={loadAttempt} onError={onLoadError}>
                  <Suspense fallback={null}>
                    <Viewer3D
                      ref={viewer}
                      theme={theme}
                      source={source}
                      scene={scene}
                      layers={ZONE_EDIT_LAYERS}
                      topView={topView}
                      onSceneStatusChange={onSceneStatusChange}
                      onSelectionChange={onViewerSelect}
                      onStatusChange={onViewerStatus}
                      boxEdit={boxEdit}
                      boxGhosts={ghosts}
                      onBoxEditChange={onBoxEditChange}
                      className={cn('absolute inset-0', !viewerReady && 'pointer-events-none')}
                    />
                  </Suspense>
                </ViewerLoadBoundary>
              </div>
            ) : (
              <div className="flex size-full items-center justify-center">{plan}</div>
            )}
          </CardContent>
        </Card>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0">
          {children}
        </div>
      </div>
    </SpatialViewportContext>
  );
}

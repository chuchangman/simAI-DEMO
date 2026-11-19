import { importViewer } from '@/features/layout/spatialHost/useViewerMode';
import { useThemeStore } from '@/features/layout/theme.store';
import { useCurrentScene } from '@/features/layout/useCurrentScene';
import { ViewerLoadBoundary } from '@/features/monitor/ViewerLoadBoundary';
import type {
  ExternalSpatialSource,
  Viewer3DHandle,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d';
import type { ViewerZones } from '@/features/zones/types';
import { Badge } from '@simai/ui/components/badge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@simai/ui/components/card';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

// 작업 전 확인의 '가상 레이아웃' 카드: 현재 배경(Scene) 위에 구역을 그린 읽기용 3D. 구역을 누르면 onPickZone 으로 알린다.
// three.js 묶음은 그릴 때 동적으로 받는다. 받지 못하거나 3D 가 멈추면 3D 칸에 안내만 남기고 카드 밖 구역 목록은 그대로 보인다.
// 세팅 보정 단계의 미리보기(SetupPreviewModel)처럼 관제 틀(useViewportHost)을 쓰지 않아, 구역 편집 창의 전역 편집 상태와 부딪치지 않는다.

const Viewer3D = lazy(importViewer);

const SOURCE_ID = 'preflight-zones';

/**
 * 이 화면만 쓰는 3D 입력(구역만, 사람은 없다). 뷰어 코드를 받을 때 같이 만들어 이 화면에서 three.js 를 미리 받지 않는다.
 * 구역 응답이 바뀔 때마다 Source 에 넣는다(Source 는 마지막 응답을 보관해 늦게 구독한 뷰어에도 보낸다).
 */
function useZoneSource(zonesRaw: ViewerZones | undefined) {
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
  useEffect(() => {
    if (source && zonesRaw) source.pushZones({ ok: true, raw: zonesRaw });
  }, [source, zonesRaw]);
  return source;
}

export function LayoutPreview({
  zoneCount,
  zonesRaw,
  onPickZone,
}: {
  /** 구역 수. 구역을 아직 받지 못했으면 null(칩을 숨긴다). */
  zoneCount: number | null;
  /** 3D 에 넘길 구역 응답(받기 전에는 undefined). */
  zonesRaw: ViewerZones | undefined;
  /** 3D 에서 구역을 눌렀다. */
  onPickZone: (zoneId: string) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const { scene, onSceneStatusChange } = useCurrentScene();
  const source = useZoneSource(zonesRaw);
  const viewer = useRef<Viewer3DHandle>(null);
  const [failed, setFailed] = useState(false);

  const onLoadError = useCallback(() => setFailed(true), []);
  const onStatusChange = useCallback((status: ViewerStatus) => {
    if (status.phase === 'error') setFailed(true);
  }, []);
  // 누른 구역은 편집 창이 따로 고르므로 이 3D 의 선택 표시는 바로 푼다.
  const onSelectionChange = useCallback(
    (target: ViewerTarget | null) => {
      if (target?.type !== 'zone') return;
      viewer.current?.clearSelection();
      onPickZone(target.id);
    },
    [onPickZone],
  );

  return (
    // 오른쪽 칸에서 남는 높이를 채운다(작업 전 확인이 페이지 스크롤 없이 화면 높이에 맞도록). 내용보다 작게 줄지는 않는다
    <Card size="sm" className="grow">
      <CardHeader>
        <CardTitle>
          <h2>가상 레이아웃</h2>
        </CardTitle>
        {zoneCount !== null && (
          <CardAction>
            <Badge variant="outline" className="rounded-[4px]">{`구역 ${zoneCount}개`}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex grow flex-col">
        <div
          data-testid="preflight-viewport"
          className="relative min-h-[180px] grow overflow-hidden rounded-lg bg-background ring-1 ring-border"
        >
          {failed ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              3D 를 표시할 수 없습니다
            </p>
          ) : (
            source && (
              <ViewerLoadBoundary onError={onLoadError}>
                <Suspense fallback={null}>
                  <Viewer3D
                    ref={viewer}
                    theme={theme}
                    source={source}
                    scene={scene}
                    onSceneStatusChange={onSceneStatusChange}
                    onSelectionChange={onSelectionChange}
                    onStatusChange={onStatusChange}
                    className="absolute inset-0"
                  />
                </Suspense>
              </ViewerLoadBoundary>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { importViewer } from '@/features/layout/spatialHost/useViewerMode';
import { useThemeStore } from '@/features/layout/theme.store';
import { useSceneOrCurrent } from '@/features/layout/useSceneView';
import { ViewerLoadBoundary } from '@/features/monitor/ViewerLoadBoundary';
import {
  sessionSceneVersion,
  zoneMapTitle,
  type SceneTierStatusView,
} from '@/features/setup/setup';
import type { ViewerStatus } from '@/features/viewer3d';
import { Loader2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';

// 보정·생성 단계의 3D 미리보기(왼쪽 칸의 탭). three.js 묶음은 그릴 때만 받는다(값은 동적 import).
const Viewer3D = lazy(importViewer);

/**
 * 세팅 1단계(카메라 연결 관리)·2단계(보정·생성)가 같이 쓰는 두 칸 배치: 왼쪽 큰 칸, 오른쪽 카드 열(320~420px).
 * 두 단계의 칸 자리·폭·높이가 같고 구역 단계(SetupZoneStep)와도 같아서 단계를 넘어가도 화면이 움직이지 않는다.
 * 높이는 남은 자리를 채우고(최소 420px) 화면 높이를 따로 계산하지 않는다. 오른쪽 카드가 길면 그 열 안에서만 스크롤한다.
 */
const SETUP_SPLIT =
  'grid min-h-[420px] flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,420px)] grid-rows-[minmax(0,1fr)] gap-3';
const SETUP_SIDE_COLUMN = 'flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto [&>*]:shrink-0';

export function SetupSplit({ left, children }: { left: ReactNode; children: ReactNode }) {
  return (
    <div className={SETUP_SPLIT}>
      {left}
      <div className={SETUP_SIDE_COLUMN}>{children}</div>
    </div>
  );
}

/**
 * 보정·생성의 3D 미리보기(왼쪽 칸 「3D 미리보기」 탭, 미리보기 맵이 준비된 뒤). Scene 을 받기 전에도(404 로 다시 받는 중이어도) 빈 틀로
 * 자리를 지켜, 받는 순간 배치가 바뀌지 않는다. 받는 동안은 로딩 표시만 두고, 3D 를 띄우지 못하면 빈 틀만 남긴다.
 * 이 세션이 만든 Scene(정밀 3D 맵이 있으면 정밀, 아니면 미리보기)을 버전을 지정해 받는다(GET /api/scenes/{scene_version}/view).
 * 만든 맵이 없는 세션(이전 맵 재사용)은 버전이 없어 지금 관제 Scene 으로 그린다. 구역 단계와 같다.
 * 관제 틀(useViewportHost)은 쓰지 않는다: 전역 편집 상태를 건드리지 않고 Scene 만 그린다.
 */
export function SetupPreviewViewport({ sceneTier }: { sceneTier: SceneTierStatusView }) {
  const theme = useThemeStore((s) => s.theme);
  const sceneVersion = sessionSceneVersion(sceneTier);
  const { scene, onSceneStatusChange } = useSceneOrCurrent(sceneVersion);
  // 3D 를 띄우지 못한 Scene 버전(null 은 지금 관제 Scene). 다른 버전(정식 Scene 등)으로 바뀌면 다시 띄워 본다.
  const [failedScene, setFailedScene] = useState<{ version: string | null } | null>(null);
  const failed = failedScene?.version === sceneVersion;
  const onLoadError = useCallback(() => setFailedScene({ version: sceneVersion }), [sceneVersion]);
  const onStatusChange = useCallback(
    (status: ViewerStatus) => {
      if (status.phase === 'error') setFailedScene({ version: sceneVersion });
    },
    [sceneVersion],
  );
  const hasModel = !failed && scene?.ok === true;
  const loading = !failed && !hasModel;

  return (
    <div
      data-testid="setup-preview-viewport"
      aria-label={zoneMapTitle(sceneTier)}
      aria-busy={loading || undefined}
      className="relative grid size-full place-items-center overflow-hidden rounded-lg bg-background text-muted-foreground"
    >
      {hasModel ? (
        <ViewerLoadBoundary onError={onLoadError}>
          <Suspense fallback={null}>
            <Viewer3D
              theme={theme}
              scene={scene}
              onSceneStatusChange={onSceneStatusChange}
              onStatusChange={onStatusChange}
              className="absolute inset-0"
            />
          </Suspense>
        </ViewerLoadBoundary>
      ) : (
        loading && <Loader2 aria-hidden className="size-6 animate-spin" />
      )}
    </div>
  );
}

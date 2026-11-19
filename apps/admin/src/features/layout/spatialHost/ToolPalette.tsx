import { useCurrentRole } from '@/features/auth/useCurrentRole';
import { useGpuKnownOff } from '@/features/gpu/useGpu';
import { SceneRegenerateTool } from '@/features/layout/spatialHost/SceneRegenerateTool';
import {
  TOOL_BUTTON_SIZE,
  TOOL_ICON,
  TOOL_ICON_CLASS,
} from '@/features/layout/spatialHost/toolIcons';
import { ToolTooltip } from '@/features/layout/spatialHost/ToolTooltip';
import type { SpatialViewMode } from '@/features/layout/spatialHost/useViewerMode';
import { useMonitorStandby } from '@/features/monitor/useTodayWorks';
import { useZoneEditActive } from '@/features/monitor/useZoneEditActive';
import { Button } from '@simai/ui/components/button';
import { TooltipProvider } from '@simai/ui/components/tooltip';

interface ToolPaletteProps {
  view: SpatialViewMode;
  onResetView: () => void;
  onRetry3d: () => void;
  currentSceneVersion: string | null;
  /** 현재 Scene 조회 응답 본문(맵 재생성 품질 표시용). */
  currentScene?: unknown;
  /** 바닥 감시 범위(-606) 켜고 끄기. 범위 자료가 없으면 넘기지 않는다(버튼을 숨긴다). */
  onToggleCoverage?: () => void;
  coverageOn?: boolean;
}

/** 3D 는 처음 시점으로 돌리고, 3D 가 멈춰 2D 를 보고 있으면 3D 를 다시 띄운다(관제 데모와 같다). */
function ViewTool({
  view,
  onResetView,
  onRetry3d,
}: Pick<ToolPaletteProps, 'view' | 'onResetView' | 'onRetry3d'>) {
  const is3d = view === '3d';
  const Icon = is3d ? TOOL_ICON.resetView : TOOL_ICON.retry3d;
  const label = is3d ? '시점 초기화' : '3D 다시 시도';
  return (
    <ToolTooltip
      label={label}
      trigger={
        <Button
          variant="ghost"
          size={TOOL_BUTTON_SIZE}
          aria-label={label}
          onClick={is3d ? onResetView : onRetry3d}
        />
      }
    >
      <Icon aria-hidden className={TOOL_ICON_CLASS} />
    </ToolTooltip>
  );
}

/** 바닥 감시 범위(2대 이상·1대·사각) 겹침을 켜고 끈다(S15P31A101-606). 켜져 있으면 눌린 모양이다. */
function CoverageTool({ on, onToggle }: { on?: boolean; onToggle: () => void }) {
  const Icon = TOOL_ICON.coverage;
  return (
    <ToolTooltip
      label="감시 범위"
      trigger={
        <Button
          variant="ghost"
          size={TOOL_BUTTON_SIZE}
          aria-label="감시 범위"
          aria-pressed={on}
          onClick={onToggle}
        />
      }
    >
      <Icon aria-hidden className={TOOL_ICON_CLASS} />
    </ToolTooltip>
  );
}

/**
 * 실시간 관제 화면의 도구 모음. 왼쪽 위에 고정된 아이콘 줄이고, 구역 목록·작업 목록 칼럼이 그 아래에 이어진다.
 * 시점 초기화(또는 3D 다시 시도) · 감시 범위(자료가 있을 때) · 맵 재생성(관리자)이 들어 있고, 버튼에 올리면 이름이 바로 뜬다.
 * 구역 편집은 구역 목록에서 들어가고 구역 편집 패널에서 끝낸다. 맵 재생성 도구는 편집 중에도 떼지 않고 숨기기만 한다
 * (진행 상태를 계속 받는다).
 */
export function ToolPalette({
  view,
  onResetView,
  onRetry3d,
  currentSceneVersion,
  currentScene,
  onToggleCoverage,
  coverageOn,
}: ToolPaletteProps) {
  const isAdmin = useCurrentRole() === 'ADMIN';
  const editing = useZoneEditActive();
  // 대기 화면이 위를 덮는 동안은 눌러도 Tab 으로도 닿지 않게 한다.
  const standby = useMonitorStandby();
  // GPU 가 꺼져 있으면 맵 재생성은 요청해도 돌 곳이 없으므로 비활성이다(S15P31A101-752).
  const gpuOff = useGpuKnownOff();

  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="도구"
        inert={standby}
        className="absolute top-[72px] left-3.5 z-[6] flex items-center gap-1 rounded-[14px] bg-card/94 p-1 shadow-float backdrop-blur-[8px]"
      >
        <ViewTool view={view} onResetView={onResetView} onRetry3d={onRetry3d} />
        {onToggleCoverage && <CoverageTool on={coverageOn} onToggle={onToggleCoverage} />}
        {isAdmin && (
          <SceneRegenerateTool
            hidden={editing}
            disabled={gpuOff}
            currentSceneVersion={currentSceneVersion}
            currentScene={currentScene}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

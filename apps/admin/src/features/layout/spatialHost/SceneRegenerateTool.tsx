import {
  parseSceneRegenerateQuality,
  SCENE_REGENERATE_MAX_REASON_LENGTH,
  SCENE_REGENERATE_PREVIOUS_FILL_NOTICE_RATIO,
  SCENE_REGENERATE_STEP_LABELS,
  sceneRegenerateFailureText,
  type SceneRegenerateStatus,
} from '@/features/layout/api';
import {
  TOOL_BUTTON_SIZE,
  TOOL_ICON,
  TOOL_ICON_CLASS,
} from '@/features/layout/spatialHost/toolIcons';
import { ToolTooltip } from '@/features/layout/spatialHost/ToolTooltip';
import { LIVE_WORK_NOTICE, useSceneRegenerate } from '@/features/layout/useSceneRegenerate';
import { Button } from '@simai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@simai/ui/components/popover';
import { cn } from '@simai/ui/lib/utils';
import { CheckCircle2, Sparkles, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

const STATUS_BADGE_CLASS: Record<SceneRegenerateStatus, string> = {
  REQUESTED: 'border-sky-500/40 bg-sky-950/80 text-sky-200',
  CAPTURING: 'border-indigo-500/40 bg-indigo-950/80 text-indigo-200',
  RECONSTRUCTING: 'border-amber-500/40 bg-amber-950/80 text-amber-200',
  CANDIDATE_READY: 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200',
  FAILED: 'border-red-500/40 bg-red-950/80 text-red-200',
};

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * 실시간 관제 화면 도구 모음의 관리자용 3D 배경(맵) 재생성 도구(S15P31A101-428). 도구 모음의 아이콘 버튼이고, 누르면
 * 사유 입력·상태·후보 활성화가 팝오버로 열린다. 관리자(ADMIN)에게만 두므로 역할은 부모가 가린다.
 * hidden(구역 편집 중)이어도 떼지 않아(버튼만 숨긴다) 팝오버가 닫혀 있어도 진행 상태를 계속 받는다.
 */
export function SceneRegenerateTool({
  hidden,
  disabled = false,
  currentSceneVersion,
  currentScene,
}: {
  hidden: boolean;
  /** GPU 가 꺼져 있어 재생성을 요청할 수 없다(S15P31A101-752). 버튼을 비활성으로 두고 까닭을 보인다. */
  disabled?: boolean;
  /** 현재 활성화된 Scene 버전(이미 후보가 활성화된 경우 버튼 상태 구분용). */
  currentSceneVersion: string | null;
  /** 현재 Scene 조회 응답 본문. `quality` 의 재생성 품질을 읽는다(-469). */
  currentScene?: unknown;
}) {
  const [reason, setReason] = useState('');
  const {
    current,
    isInProgress,
    liveWorkInProgress,
    isSubmitting,
    isActivating,
    activatedSceneVersion,
    requestError,
    regenerate,
    activateCandidate,
  } = useSceneRegenerate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await regenerate(reason);
  };

  const busy = isInProgress || isSubmitting;
  const Icon = busy ? TOOL_ICON.busy : TOOL_ICON.regenerate;
  const quality = parseSceneRegenerateQuality(currentScene);
  const cameras = quality?.camera_background_quality
    ? Object.entries(quality.camera_background_quality)
    : [];
  const candidateVersion =
    current?.status === 'CANDIDATE_READY' ? (current.scene_version ?? null) : null;
  const isCandidateAlreadyActive =
    candidateVersion !== null &&
    (activatedSceneVersion === candidateVersion || currentSceneVersion === candidateVersion);

  return (
    <Popover>
      <ToolTooltip
        label={disabled ? 'GPU 꺼짐 · GPU 를 켠 뒤 맵을 재생성할 수 있습니다' : '맵 재생성'}
        trigger={
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size={TOOL_BUTTON_SIZE}
                aria-label="맵 재생성"
                aria-busy={busy}
                hidden={hidden}
                disabled={disabled}
              />
            }
          />
        }
      >
        <Icon aria-hidden className={cn(TOOL_ICON_CLASS, busy && 'animate-spin')} />
      </ToolTooltip>
      <PopoverContent
        data-testid="scene-regenerate-tool"
        aria-label="맵 재생성 도구"
        className="text-xs"
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={SCENE_REGENERATE_MAX_REASON_LENGTH}
            disabled={busy}
            placeholder={`재생성 사유 (선택, ${SCENE_REGENERATE_MAX_REASON_LENGTH}자)`}
            aria-label="재생성 사유"
            className="h-7 w-40 rounded border border-border bg-background/80 px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || liveWorkInProgress}
            title={liveWorkInProgress ? LIVE_WORK_NOTICE : undefined}
            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            재생성 요청
          </button>
        </form>

        {liveWorkInProgress && (
          <p data-testid="scene-regenerate-live-notice" className="text-[11px] text-amber-400">
            {LIVE_WORK_NOTICE}
          </p>
        )}

        {current && (
          <div className="flex flex-wrap items-center gap-1.5" role="status" aria-live="polite">
            <span
              data-testid="scene-regenerate-status"
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASS[current.status]}`}
            >
              {isInProgress && (
                <TOOL_ICON.busy className="h-3 w-3 animate-spin" aria-hidden="true" />
              )}
              {SCENE_REGENERATE_STEP_LABELS[current.status]}
            </span>

            {current.status === 'FAILED' && (
              <span
                data-testid="scene-regenerate-failure-reason"
                className="inline-flex items-center gap-1 text-[11px] text-red-400"
              >
                <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                {sceneRegenerateFailureText(current.failure_reason)}
              </span>
            )}

            {candidateVersion && !isCandidateAlreadyActive && (
              <button
                type="button"
                onClick={() => void activateCandidate()}
                disabled={isActivating}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                <span>새 3D 배경 후보 — 활성화</span>
              </button>
            )}

            {candidateVersion && isCandidateAlreadyActive && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />새 3D 배경 활성화됨 (
                {candidateVersion})
              </span>
            )}
          </div>
        )}

        {quality && (
          <div data-testid="scene-regenerate-quality" className="flex flex-col gap-0.5 text-[11px]">
            <span className="text-muted-foreground">
              이전 모습으로 채움 {pct(quality.previous_fill_ratio)} · 비움{' '}
              {pct(quality.unrevealed_ratio)}
            </span>
            {cameras.length > 0 && (
              <span
                data-testid="scene-regenerate-quality-cameras"
                className="text-muted-foreground"
              >
                {cameras
                  .map(
                    ([id, q]) =>
                      `${id} 채움 ${pct(q.previous_fill_ratio)}/비움 ${pct(q.unrevealed_ratio)}`,
                  )
                  .join(' · ')}
              </span>
            )}
            {quality.previous_fill_ratio >= SCENE_REGENERATE_PREVIOUS_FILL_NOTICE_RATIO && (
              <span data-testid="scene-regenerate-quality-notice" className="text-violet-300">
                일부는 이전 모습입니다
              </span>
            )}
          </div>
        )}

        {requestError && (
          <p role="alert" className="text-[11px] text-amber-400">
            {requestError}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

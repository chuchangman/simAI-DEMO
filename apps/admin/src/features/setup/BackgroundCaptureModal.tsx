import { tileLabel } from '@/features/cctv/cctv';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { DIMMED, TILE_FRAME } from '@/features/cctv/tileStyle';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import {
  captureStatusText,
  type CaptureCameraView,
  type CaptureView,
} from '@/features/setup/backgroundCapture';
import type { SetupTone, StageAAlertView } from '@/features/setup/setup';
import { readPreviewUrls } from '@/features/setup/SetupPanels';
import { StageAWarning } from '@/features/setup/StageAWarning';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, ALERT, H2, NOTE, SECONDARY } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useCallback } from 'react';

// 세팅 배경 촬영 창(S15P31A101-686). 보정을 시작할 때 크게 띄워 카메라 4대 영상과 카메라별 촬영 상태를 보인다.
// 사용자가 「시작」을 눌러야 촬영이 시작되고(세팅 세션을 만든다), Esc·바깥 클릭으로 닫히지 않는다. 다 찍으면 부모가 창을 닫는다.
// 사람이 보이거나 영상이 없는 카메라는 그 카메라만 이어서 찍는다고 알린다. 끝내 못 찍어 세팅이 끝나면 그 카메라를 알리고 다시 찍게 한다.

const STATE_TEXT: Record<SetupTone, string> = {
  ok: 'text-ok',
  active: 'text-point-soft',
  delay: 'text-delay',
  idle: 'text-muted-foreground',
};

const BAR: Record<SetupTone, string> = {
  ok: 'bg-ok',
  active: 'bg-primary',
  delay: 'bg-delay',
  idle: 'bg-faint',
};

const CAPTION =
  'absolute flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-xs backdrop-blur-[4px]';

function CaptureTile({
  camera,
  attach,
  showState,
}: {
  camera: CaptureCameraView;
  attach: (cameraId: string, canvas: HTMLCanvasElement | null) => void;
  showState: boolean;
}) {
  const phase = useCctvStore((s) => s.views[camera.id]?.phase);
  const link = useCctvStore((s) => s.link);
  const playing = link === 'open' && phase === 'playing';
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => attach(camera.id, canvas),
    [attach, camera.id],
  );
  const blocked = showState && camera.hint !== null;
  return (
    <li
      aria-label={camera.label}
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        blocked && 'rounded-lg ring-2 ring-delay ring-offset-2 ring-offset-card',
      )}
    >
      <div className="aspect-video w-full">
        <div className={cn(TILE_FRAME, 'bg-surface-2')}>
          <canvas
            ref={ref}
            aria-label={`${camera.label} 영상`}
            className={cn('size-full object-contain', !playing && DIMMED)}
          />
          <span className={cn(CAPTION, 'top-2 left-2')}>
            <span className="font-semibold">{camera.label}</span>
            <span>
              {tileLabel(phase, link).replace('원격 시청 멈춤', '미리보기 멈춤(촬영 계속)')}
            </span>
          </span>
          {blocked && (
            <div className="absolute inset-x-3 bottom-3 rounded-md bg-card/90 px-3 py-2 text-sm backdrop-blur-[4px]">
              <p className="font-semibold text-delay">{camera.title}</p>
              <p className="text-foreground">{camera.hint}</p>
            </div>
          )}
        </div>
      </div>
      {showState && (
        <div className="flex items-center gap-2 px-0.5 text-sm">
          <span className={cn('min-w-0 flex-1 truncate font-semibold', STATE_TEXT[camera.tone])}>
            {camera.state === 'PERSON_OCCLUDED' ? '사람이 보여 기다리는 중' : camera.title}
          </span>
          <span
            role="progressbar"
            aria-label={`${camera.label} 촬영 진행`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(camera.progress * 100)}
            className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-surface-3"
          >
            <span
              className={cn('block h-full rounded-full', BAR[camera.tone])}
              style={{ width: `${Math.round(camera.progress * 100)}%` }}
            />
          </span>
        </div>
      )}
    </li>
  );
}

export function BackgroundCaptureModal({
  view,
  secondsLeft,
  waitingForWorker,
  waitingSeconds = 0,
  onStart,
  onCancel,
  onRetry,
  onClose,
  cancelPending = false,
  retryPending = false,
  error = null,
  stageAAlerts = [],
}: {
  view: CaptureView;
  /** 카운트다운 남은 초. 촬영이 아직 시작되지 않았으면 CAPTURE_SECONDS. */
  secondsLeft: number;
  /** 세션은 만들었지만 워커가 아직 촬영을 시작하지 않았다. */
  waitingForWorker: boolean;
  waitingSeconds?: number;
  /** 「시작」: 세팅 세션을 만들어 촬영을 시작한다. */
  onStart: () => void;
  /** 시작 전 「취소」 또는 촬영 중 「촬영 취소」(세팅 세션을 취소한다). */
  onCancel: () => void;
  /** 못 찍고 끝난 뒤 「다시 촬영」. */
  onRetry: () => void;
  /** 못 찍고 끝난 뒤 「닫기」. */
  onClose: () => void;
  cancelPending?: boolean;
  retryPending?: boolean;
  /** 다시 촬영 요청이 실패한 까닭. */
  error?: string | null;
  /** 세팅 보정 기준 미달·불안정 옆 쌍(S15P31A101-761). 「시작」 전에 경고만 보이고 막지 않는다. */
  stageAAlerts?: readonly StageAAlertView[];
}) {
  const { localUrl, stompUrl } = readPreviewUrls();
  const { attach } = useCctvPreview(localUrl, stompUrl);
  const { phase } = view;
  const capturing = phase === 'capturing';
  const status = captureStatusText(view, secondsLeft, waitingForWorker, waitingSeconds);

  return (
    <ModalDialog
      label="배경 촬영"
      // 촬영 중 실수로 닫히지 않게 Esc 는 무시한다(바깥 클릭도 닫지 않는다). 닫기는 아래 단추로만 한다.
      onClose={() => {}}
      className="w-[min(1120px,calc(100vw-48px))]"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <div className="flex flex-none items-start gap-4 px-5 pt-[18px] pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className={H2}>배경 촬영</h2>
            <p
              role="status"
              className={cn('text-sm', phase === 'failed' ? 'text-destructive' : 'text-foreground')}
            >
              {status}
            </p>
          </div>
          {capturing && !waitingForWorker && (
            <div
              aria-label="남은 시간"
              className="flex-none font-mono text-4xl leading-none font-bold text-foreground tabular-nums"
            >
              {secondsLeft}
              <span className="ml-1 text-base font-medium text-muted-foreground">초</span>
            </div>
          )}
        </div>
        <ul
          aria-label="카메라 영상"
          className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto px-5 pb-4 sm:grid-cols-2"
        >
          {view.cameras.map((camera) => (
            <CaptureTile
              key={camera.id}
              camera={camera}
              attach={attach}
              showState={(capturing && !waitingForWorker) || phase === 'failed'}
            />
          ))}
        </ul>
        {phase === 'ready' && <StageAWarning alerts={stageAAlerts} className="mx-5 mb-3 w-auto" />}
        {phase === 'failed' && (
          <p className={cn(ALERT, 'mx-5 mb-3')}>
            {error ??
              '사람이 있던 자리나 영상이 없는 카메라는 새로 찍은 화면이 있어야 3D 맵을 만들 수 있습니다.'}
          </p>
        )}
        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className={NOTE}>세팅을 시작한 뒤 새로 찍은 화면만 씁니다.</p>
          <div className="flex items-center gap-2">
            {phase === 'ready' && (
              <>
                <Button variant="secondary" onClick={onCancel} className={SECONDARY}>
                  취소
                </Button>
                <Button onClick={onStart} className={ACTION}>
                  시작
                </Button>
              </>
            )}
            {phase === 'starting' && (
              <Button disabled className={ACTION}>
                시작하는 중
              </Button>
            )}
            {capturing && (
              <Button
                variant="secondary"
                onClick={onCancel}
                disabled={cancelPending}
                className={SECONDARY}
              >
                촬영 취소
              </Button>
            )}
            {phase === 'failed' && (
              <>
                <Button variant="secondary" onClick={onClose} className={SECONDARY}>
                  닫기
                </Button>
                <Button onClick={onRetry} disabled={retryPending} className={ACTION}>
                  다시 촬영
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

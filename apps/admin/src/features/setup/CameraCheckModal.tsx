import { tileLabel } from '@/features/cctv/cctv';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { DIMMED, TILE_FRAME } from '@/features/cctv/tileStyle';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import {
  type CameraWalkView,
  type LiveCamerasView,
  WALK_TARGET_SECONDS,
  type WalkCameraView,
  walkGuide,
  walkStatus,
} from '@/features/setup/cameraCheck';
import { readPreviewUrls } from '@/features/setup/SetupPanels';
import { useLiveCameras } from '@/features/setup/useCameraWalk';
import { ModalDialog } from '@/features/tbm/ModalDialog';
import { ACTION, ALERT, H2, NOTE, SECONDARY } from '@/features/tbm/styles';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useCallback } from 'react';

// 카메라 확인 걷기 창(S15P31A101-687). 보정이 끝나면 맵을 굽기 전에 크게 띄워 카메라 4대 영상과 카메라별 사람 보임·진행을 보인다.
// 사용자가 「걷기 시작」을 눌러야 확인이 시작되고(30초 목표), Esc·바깥 클릭으로 닫히지 않는다. 통과하면 부모가 창을 닫는다.
// 실패하면 표본 부족(사람이 덜 보임)과 기하 실패(카메라 위치가 보정과 맞지 않음)를 나눠 안내하고, 주 단추는 「확인만 다시(30초)」
// (보정은 그대로, 걷기만 다시)이고 「현재 시도 중단」은 보조다.
// S15P31A101-763: 걷기 전에는 걷는 방법(한 사람·방 가운데·옆 카메라 쌍·60~90초)을, 걷는 중에는 「지금 보는 카메라 n/4」와 카메라별
// 점등을 크게 보이고, 한동안 아무 카메라도 사람을 못 보면 경고한다. 아직 0 인 필수 쌍과 재투영 표본이 모자란 카메라를 짚는다.

const CAPTION =
  'absolute flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-xs backdrop-blur-[4px]';

function WalkTile({
  camera,
  attach,
  showCount,
  live,
}: {
  camera: WalkCameraView;
  attach: (cameraId: string, canvas: HTMLCanvasElement | null) => void;
  showCount: boolean;
  /** 지금 보는 카메라인지(걷는 중, S15P31A101-763). 모르면 null 이고 워커의 최근 보임(visible)을 쓴다. */
  live: boolean | null;
}) {
  const phase = useCctvStore((s) => s.views[camera.id]?.phase);
  const link = useCctvStore((s) => s.link);
  const playing = link === 'open' && phase === 'playing';
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => attach(camera.id, canvas),
    [attach, camera.id],
  );
  const done = camera.observed >= camera.need;
  const visible = live ?? camera.visible;
  const ratio = Math.min(1, camera.need > 0 ? camera.observed / camera.need : 0);
  return (
    <li
      aria-label={camera.label}
      className={cn(
        'flex min-w-0 flex-col gap-1.5',
        camera.flagged && 'rounded-lg ring-2 ring-delay ring-offset-2 ring-offset-card',
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
              {link === 'stopped' ? '미리보기 멈춤(걷기 확인 계속)' : tileLabel(phase, link)}
            </span>
          </span>
          {visible !== null && (
            <span
              className={cn(
                CAPTION,
                'top-2 right-2 font-semibold',
                visible ? 'text-ok' : 'text-muted-foreground',
              )}
            >
              {visible ? '사람 보임' : '사람 안 보임'}
            </span>
          )}
        </div>
      </div>
      {showCount && (
        <div className="flex items-center gap-2 px-0.5 text-sm">
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-semibold',
              camera.looShort
                ? 'text-delay'
                : done
                  ? 'text-ok'
                  : camera.flagged
                    ? 'text-delay'
                    : 'text-muted-foreground',
            )}
          >
            {camera.looShort
              ? `방 가운데를 지나세요 · 함께 보임 ${camera.looSamples}/${camera.looNeed}`
              : done
                ? '충분히 보임'
                : `사람 보인 횟수 ${camera.observed}/${camera.need}`}
          </span>
          <span
            role="progressbar"
            aria-label={`${camera.label} 확인 진행`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            className="h-1.5 w-24 flex-none overflow-hidden rounded-full bg-surface-3"
          >
            <span
              className={cn('block h-full rounded-full', done ? 'bg-ok' : 'bg-primary')}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </span>
        </div>
      )}
    </li>
  );
}

/** 걷기 시작 전 걷는 방법(S15P31A101-763). */
function WalkGuide({ cameraIds }: { cameraIds: readonly string[] }) {
  return (
    <ol
      aria-label="걷는 방법"
      className="mx-5 mb-3 flex flex-none list-decimal flex-col gap-1 rounded-lg border border-border bg-surface-2 py-3 pr-4 pl-9 text-base font-medium"
    >
      {walkGuide(cameraIds).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ol>
  );
}

/** 걷는 중 「지금 보는 카메라 n/4」와 카메라별 점등(S15P31A101-763). */
function LiveCameras({
  live,
  suppressWarning,
}: {
  live: LiveCamerasView;
  suppressWarning: boolean;
}) {
  return (
    <section
      aria-label="지금 보는 카메라"
      className="mx-5 mb-3 flex flex-none flex-col gap-2 rounded-lg border border-border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="text-2xl font-bold tabular-nums">
          지금 보는 카메라 {live.liveCount}/{live.total}
        </p>
        <ul aria-label="카메라별 지금 보임" className="flex flex-wrap gap-2">
          {live.cameras.map((c) => (
            <li
              key={c.id}
              data-live={c.live}
              aria-label={`${c.label} ${c.live ? '보는 중' : '안 보임'}`}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                c.live ? 'border-ok text-ok' : 'border-border text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn('size-3 rounded-full', c.live ? 'bg-ok' : 'bg-surface-3')}
              />
              {c.label}
            </li>
          ))}
        </ul>
      </div>
      {live.noPerson && !suppressWarning && (
        <p role="alert" className="text-lg font-semibold text-delay">
          사람이 안 보입니다 — 카메라 앞으로 걸어 들어오세요
        </p>
      )}
    </section>
  );
}

function waitNote(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `약 ${minutes}분 안에 시작하지 않으면 맵을 만들지 않고 세팅이 멈춥니다.`;
}

export function CameraCheckModal({
  view,
  secondsLeft,
  onStart,
  onStop,
  startPending = false,
  stopPending = false,
  error = null,
}: {
  view: CameraWalkView;
  /** 걷기 카운트다운 남은 초(목표 30초). */
  secondsLeft: number;
  /** 「걷기 시작」·「확인만 다시」: 다음 시도 번호로 요청한다. */
  onStart: (attempt: number) => void;
  /** 「현재 시도 중단」(세팅 세션을 멈추고 카메라 연결 관리로 돌아간다). */
  onStop: () => void;
  startPending?: boolean;
  stopPending?: boolean;
  /** 걷기 시작 요청이 실패한 까닭. */
  error?: string | null;
}) {
  const { localUrl, stompUrl } = readPreviewUrls();
  const { attach } = useCctvPreview(localUrl, stompUrl);
  const { phase, failure } = view;
  const walking = phase === 'WALKING';
  const retry = phase === 'RETRY_WAIT';
  const live = useLiveCameras(view);

  const { status, hint } = walkStatus(view, secondsLeft);

  return (
    <ModalDialog
      label="카메라 확인"
      // 걷는 중 실수로 닫히지 않게 Esc 는 무시한다(바깥 클릭도 닫지 않는다). 통과하면 부모가 닫는다.
      onClose={() => {}}
      className="w-[min(1120px,calc(100vw-48px))]"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <div className="flex flex-none items-start gap-4 px-5 pt-[18px] pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className={H2}>카메라 확인 · 걷기</h2>
            {retry && failure && (
              <p
                role="alert"
                className={cn(
                  'text-base font-semibold',
                  failure.kind === 'geometry' ? 'text-destructive' : 'text-delay',
                )}
              >
                {failure.title}
              </p>
            )}
            {hint && (
              <p role="alert" className="text-base font-semibold text-delay">
                {hint.title}
              </p>
            )}
            <p role="status" className="text-sm text-foreground">
              {hint ? hint.action : status}
            </p>
          </div>
          {walking && (
            <div
              aria-label="남은 시간"
              className="flex-none font-mono text-4xl leading-none font-bold text-foreground tabular-nums"
            >
              {secondsLeft}
              <span className="ml-1 text-base font-medium text-muted-foreground">초</span>
            </div>
          )}
        </div>
        {(phase === 'AWAITING_START' || phase === 'STARTING') && (
          <WalkGuide cameraIds={view.cameras.map((c) => c.id)} />
        )}
        {walking && (
          <div
            role="progressbar"
            aria-label="카메라 확인 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(view.progressPct)}
            className="mx-5 mb-3 h-1.5 flex-none overflow-hidden rounded-full bg-surface-3"
          >
            <div
              className="h-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.round(view.progressPct)}%` }}
            />
          </div>
        )}
        {live && <LiveCameras live={live} suppressWarning={hint !== null} />}
        <ul
          aria-label="카메라 영상"
          className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto px-5 pb-4 sm:grid-cols-2"
        >
          {view.cameras.map((camera) => (
            <WalkTile
              key={camera.id}
              camera={camera}
              attach={attach}
              showCount={walking || retry}
              live={live?.cameras.find((c) => c.id === camera.id)?.live ?? null}
            />
          ))}
        </ul>
        {(walking || retry) &&
          (view.pairs.length > 0 ? (
            <ul
              aria-label="카메라 쌍별 함께 보임"
              className="mx-5 mb-3 grid flex-none grid-cols-2 gap-2 text-sm"
            >
              {view.pairs.map((pair) => (
                <li
                  key={pair.key}
                  data-shortage={pair.shortage}
                  data-zero={pair.zero}
                  className={cn(
                    'rounded-md border border-border px-3 py-2',
                    pair.shortage && 'border-delay bg-delay/10 font-semibold text-delay',
                    pair.zero && 'border-2',
                  )}
                >
                  <p>{pair.label}</p>
                  <p>
                    {pair.required
                      ? `함께 보임 ${pair.samples}/${pair.need}`
                      : '함께 보임 확인 대상 아님'}
                  </p>
                  {pair.zero && <p>아직 0 · 두 카메라 사이를 지나가세요</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="mx-5 mb-3 text-sm text-muted-foreground">
              서버가 쌍별 진행을 아직 보내지 않았어요. 한 사람이 두 카메라가 함께 보는 곳을 지나가
              주세요.
            </p>
          ))}
        {error && <p className={cn(ALERT, 'mx-5 mb-3')}>{error}</p>}
        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className={NOTE}>
            {phase === 'AWAITING_START' || retry
              ? (waitNote(view.waitSeconds) ?? '보정은 그대로 두고 걷기만 확인합니다.')
              : '보정은 그대로 두고 걷기만 확인합니다.'}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={onStop}
              disabled={stopPending}
              className={SECONDARY}
            >
              현재 시도 중단
            </Button>
            {phase === 'AWAITING_START' && (
              <Button
                onClick={() => onStart(view.nextAttempt)}
                disabled={startPending}
                className={ACTION}
              >
                걷기 시작
              </Button>
            )}
            {phase === 'STARTING' && (
              <Button disabled className={ACTION}>
                시작하는 중
              </Button>
            )}
            {retry && (
              <Button
                onClick={() => onStart(view.nextAttempt)}
                disabled={startPending}
                className={ACTION}
              >
                확인만 다시({WALK_TARGET_SECONDS}초)
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

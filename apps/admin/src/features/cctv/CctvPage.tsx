import { useCurrentRole } from '@/features/auth/useCurrentRole';
import {
  disconnectAction,
  remoteNotice,
  showsState,
  STATE_LABEL,
  tileBadge,
  tileLabel,
  type CameraState,
  type TileBadge,
} from '@/features/cctv/cctv';
import { useCctvStore, type PreviewLink } from '@/features/cctv/cctv.store';
import { CctvDemo } from '@/features/cctv/CctvDemo';
import { CctvWall, type WallTile } from '@/features/cctv/CctvWall';
import { isZoomed, panZoomTransform, visibleRect, type PanZoomView } from '@/features/cctv/panZoom';
import { DIMMED, TILE_FRAME, tilePan, tileZoom } from '@/features/cctv/tileStyle';
import { useCameraStates } from '@/features/cctv/useCameraStates';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { usePanZoom } from '@/features/cctv/usePanZoom';
import { PageTitle } from '@/features/layout/PageTitle';
import { useCameraNames } from '@/hooks/useCameraNames';
import { useTier0Connected } from '@/hooks/useTier0Connected';
import { env } from '@/lib/env';
import { LAG_OK_MS, LAG_WARN_MS, LAG_WINDOW_MS, type LagLevel } from '@/lib/tier0Lag';
import { selectCameraLagMs, useRealtimeStore } from '@/store/realtime.store';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useCallback } from 'react';

// CCTV 관제(명세 3.3·16장, FR-133): 현장 노트북 영상 중계가 이미 받은 카메라 4대 H.264 를 WebCodecs 로 원본 해상도 그대로
// 4분할에 그린다. 한 칸을 누르면 그 칸을 크게, 나머지를 옆에 둔다. 같은 노트북이면 루프백(127.0.0.1)으로, 아니면 EC2 원격 시청
// (S15P31A101-400, 저장 없이 나눠 줌, 보는 사람이 있을 때만 게이트웨이가 올림)으로 받는다. 영상은 알림·판정에 쓰지 않는다.
// 영상은 관리자만 본다. 다른 역할은 카메라 상태(실시간·끊김)만 본다. 정지(지금 값을 모름)는 상태 글을 두지 않는다(S15P31A101-665).
// 칸 오른쪽 위에는 그 카메라의 촬영→판정 지연(ms)을 세 단계 색 배지로, 그 카메라만 신호가 없으면 끊김을 보인다. Tier 0(GPU)가
// 이어지지 않았으면(꺼 둔 정상 상태 포함) 배지를 두지 않는다(S15P31A101-704, lib/tier0Lag·tileBadge).
// 관리자인데 이어지지 않은 동안(연결 중·붙지 못함·끊김·WebCodecs 없음·원격 멈춤)은 상태 한 줄과 그 아래 모의 화면을 보인다.
// 영상 칸은 휠로 확대하고 확대 중에는 끌어서 옮긴다(usePanZoom). 캔버스에 CSS transform 만 주므로 그리기는 그대로다.

type Attach = (cameraId: string, canvas: HTMLCanvasElement | null) => void;

const CAPTION =
  'absolute flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-sm backdrop-blur-[4px]';

/** 지연 단계별 점·글자 색. 초록 < 300 ms, 노랑 < 600 ms, 빨강 ≥ 600 ms(사용자 결정, S15P31A101-704). */
const LAG_TONE: Record<LagLevel, { dot: string; text: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok' },
  warn: { dot: 'bg-sev-caution', text: 'text-sev-caution' },
  high: { dot: 'bg-sev-critical', text: 'font-semibold text-sev-critical' },
};

/** 칸 오른쪽 위 배지 값. 실시간 칸만 카메라 지연(최근 몇 초 평균)을 읽는다. */
function useTileBadge(cameraId: string, state: CameraState): TileBadge | null {
  const tier0Connected = useTier0Connected();
  const lagMs = useRealtimeStore((s) =>
    state === 'live' ? selectCameraLagMs(s, cameraId) : undefined,
  );
  return tileBadge(tier0Connected, state, lagMs);
}

/** 칸 오른쪽 위 배지: 지연(ms, 색 점) 또는 끊김. 없으면 그리지 않는다. */
function CameraBadge({ cameraId, badge }: { cameraId: string; badge: TileBadge | null }) {
  const label = useCameraNames();
  if (!badge) return null;
  if (badge.kind === 'down') {
    return (
      <span
        className={cn(CAPTION, 'top-2 right-2 font-semibold')}
        aria-label={`${label(cameraId)} 끊김`}
      >
        끊김
      </span>
    );
  }
  const tone = LAG_TONE[badge.level];
  return (
    <span
      className={cn(CAPTION, 'top-2 right-2 gap-1.5 font-mono', tone.text)}
      aria-label={`${label(cameraId)} 판정 지연 ${badge.ms} ms`}
      title={`판정 지연: 이 카메라가 찍은 뒤 위험 판정(Tier 0)까지 걸린 시간, 최근 ${LAG_WINDOW_MS / 1000}초 평균. ${LAG_OK_MS} ms 미만 초록, ${LAG_WARN_MS} ms 이상 빨강`}
    >
      <i aria-hidden className={cn('size-[7px] rounded-full', tone.dot)} />
      판정 {badge.ms} ms
    </span>
  );
}

const toPercent = (ratio: number) => `${ratio * 100}%`;

/** 확대 중 오른쪽 아래에 지금 보는 자리를 작은 상자로 보인다. */
function ZoomMap({ view }: { view: PanZoomView }) {
  if (!isZoomed(view)) return null;
  const { left, top, width, height } = visibleRect(view);
  return (
    <span
      role="img"
      aria-label="확대한 자리"
      className="pointer-events-none absolute right-2 bottom-2 aspect-video w-24 rounded-sm bg-card/80 ring-1 ring-border backdrop-blur-[4px]"
    >
      <i
        className="absolute bg-primary/35 ring-1 ring-primary"
        style={{
          left: toPercent(left),
          top: toPercent(top),
          width: toPercent(width),
          height: toPercent(height),
        }}
      />
    </span>
  );
}

/** 카메라 영상 칸. 이 화면의 4분할과 실시간 관제의 「CCTV로 확인」 패널이 함께 쓴다. 왼쪽 위에는 카메라 이름만 둔다. */
export function CameraTile({
  cameraId,
  attach,
  state,
  wall,
}: {
  cameraId: string;
  attach: Attach;
  state: CameraState;
  /** 크게 보기 배치(CctvWall)에서만. 없으면 누르는 칸이 아니라 영상만 보인다. */
  wall?: WallTile;
}) {
  const label = useCameraNames();
  const badge = useTileBadge(cameraId, state);
  const phase = useCctvStore((s) => s.views[cameraId]?.phase);
  const link = useCctvStore((s) => s.link);
  const playing = link === 'open' && phase === 'playing';
  const { ref: tileRef, view, zoomed, dragging, handlers } = usePanZoom();
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => attach(cameraId, canvas),
    [attach, cameraId],
  );
  const content = (
    <>
      <canvas
        ref={ref}
        aria-label={`${label(cameraId)} 영상`}
        // 흐리게는 영상 자체가 멈췄을 때만. Tier 0 상태(지연·끊김)는 오른쪽 위 배지로 알린다 —
        // Pod 가 없을 때 들어오는 영상까지 45% 로 흐려 물빠진 색으로 보였다(2026-11-02)
        className={cn(
          'size-full origin-top-left object-contain',
          zoomed && 'will-change-transform',
          !playing && DIMMED,
        )}
        style={{ transform: panZoomTransform(view) }}
      />
      <span className={cn(CAPTION, 'top-2 left-2 font-mono font-semibold')} title={cameraId}>
        {label(cameraId)}
      </span>
      <CameraBadge cameraId={cameraId} badge={badge} />
      <ZoomMap view={view} />
    </>
  );
  const pan = zoomed && tilePan(dragging);
  if (!wall) {
    return (
      <div ref={tileRef} {...handlers} className={cn(TILE_FRAME, 'bg-surface-2', pan)}>
        {content}
      </div>
    );
  }
  return (
    <button
      ref={tileRef}
      {...handlers}
      type="button"
      onClick={wall.toggle}
      aria-label={`${label(cameraId)} ${wall.focused ? '작게 보기' : '크게 보기'}`}
      className={cn(TILE_FRAME, 'bg-surface-2', tileZoom(wall.focused), pan)}
    >
      {content}
    </button>
  );
}

/** 관리자가 아닐 때: 영상 없이 카메라 상태만 보인다. 정지는 상태 글을 두지 않는다. 지연은 오른쪽 위 배지다. */
export function StateTile({ cameraId, state }: { cameraId: string; state: CameraState }) {
  const label = useCameraNames();
  const badge = useTileBadge(cameraId, state);
  return (
    <div
      role="group"
      aria-label={`${label(cameraId)} 상태`}
      className={cn(TILE_FRAME, 'flex items-center justify-center bg-surface-2')}
    >
      <span className={cn(CAPTION, 'top-2 left-2 font-mono font-semibold')} title={cameraId}>
        {label(cameraId)}
      </span>
      {/* 끊김은 가운데 글로 보이므로 배지는 지연만 둔다. */}
      <CameraBadge cameraId={cameraId} badge={badge?.kind === 'lag' ? badge : null} />
      {showsState(state) && (
        <span
          className={cn('text-xl', state === 'live' ? 'font-medium' : 'font-semibold text-delay')}
        >
          {STATE_LABEL[state]}
        </span>
      )}
    </div>
  );
}

/** 영상 없이 카메라 상태만(관리자가 아닌 역할). 카메라 목록은 Tier 0 health 에서 온다. */
function StatesOnly() {
  const { cameras, stateOf } = useCameraStates();
  if (cameras.length === 0) {
    return (
      <p role="status" className="text-muted-foreground">
        카메라 상태를 받지 못했습니다
      </p>
    );
  }
  return (
    <CctvWall
      ids={cameras.map((camera) => camera.id)}
      focusable={false}
      tile={(id) => <StateTile cameraId={id} state={stateOf(id)} />}
    />
  );
}

/** 중계와 이어지지 않았을 때: 연결 상태 한 줄·행동 유도 문구와 그 아래 모의 화면(한 번 붙은 뒤 끊겨도 같다). */
function MockWithStatus({ link }: { link: PreviewLink }) {
  const action = disconnectAction(link);
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p role="status" className="text-sm font-semibold">
          {tileLabel(undefined, link)}
        </p>
        {action && <p className="text-sm text-muted-foreground">{action}</p>}
      </div>
      <CctvDemo />
    </>
  );
}

/** 원격 시청 안내(멈춤·상한·게이트웨이 대기)와 "다시 보기". */
function RemoteNoticeLine({ resume }: { resume: () => void }) {
  const mode = useCctvStore((s) => s.mode);
  const pause = useCctvStore((s) => s.pause);
  const remote = useCctvStore((s) => s.remote);
  const notice = remoteNotice(mode, pause, remote);
  if (!notice) return null;
  return (
    <div role="status" aria-label="원격 시청 안내" className="flex items-center gap-3 text-sm">
      <span className="font-semibold">{notice.text}</span>
      {notice.resumable && (
        <Button size="sm" variant="outline" onClick={resume}>
          다시 보기
        </Button>
      )}
    </div>
  );
}

function AdminCctv() {
  const { attach, resume } = useCctvPreview(env.VITE_CCTV_PREVIEW_URL, env.VITE_STOMP_URL);
  return (
    <>
      <RemoteNoticeLine resume={resume} />
      <AdminWall attach={attach} />
    </>
  );
}

function AdminWall({ attach }: { attach: Attach }) {
  const link = useCctvStore((s) => s.link);
  const cameras = useCctvStore((s) => s.cameras);
  const { stateOf } = useCameraStates();

  if (link !== 'open') return <MockWithStatus link={link} />;
  if (cameras.length === 0)
    return <p className="text-muted-foreground">{tileLabel(undefined, link)}</p>;
  return (
    <CctvWall
      ids={cameras}
      tile={(id, wall) => (
        <CameraTile cameraId={id} attach={attach} state={stateOf(id)} wall={wall} />
      )}
    />
  );
}

export function CctvPage() {
  const isAdmin = useCurrentRole() === 'ADMIN';
  return (
    <div
      data-slot="cctv-page"
      className="flex min-h-0 flex-1 flex-col gap-3 pt-(--notices-h,0px) transition-[padding] duration-150"
    >
      <PageTitle>CCTV 관제</PageTitle>
      {isAdmin ? <AdminCctv /> : <StatesOnly />}
    </div>
  );
}

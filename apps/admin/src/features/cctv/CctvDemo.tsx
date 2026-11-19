import {
  CCTV_CAMS,
  CCTV_H,
  CCTV_W,
  cctvBackdrop,
  cctvFigures,
  cctvPeople,
  cctvProj,
  type CctvCam,
  type CctvPerson,
  type CctvProjector,
} from '@/features/cctv/cctvMockView';
import { CctvWall, type WallRest } from '@/features/cctv/CctvWall';
import { DIMMED, LIVE_DOT, TILE_FRAME, tileZoom } from '@/features/cctv/tileStyle';
import { useCameraStates } from '@/features/cctv/useCameraStates';
import { clockLabel } from '@/features/layout/status';
import { useNow } from '@/features/layout/useNow';
import { cameraLabel } from '@/lib/cameraNames';
import { useRealtimeStore } from '@/store/realtime.store';
import type { WorldTrack } from '@simai/contracts';
import { cn } from '@simai/ui/lib/utils';
import type { ReactNode } from 'react';

// 중계와 이어지지 않았을 때의 CCTV 모의 화면(관제 데모와 같다). 실제 영상 대신 각 카메라에서 본 교실에
// World 의 사람을 투영해 그린다. 그림은 두 모드 모두 어두운 영상처럼 보이게 slate 색만 쓴다.
// 화면 틀(CctvMockWall)은 사람·멈춤·배지 글을 받아 그리고, 실시간(CctvDemo)과 히스토리 다시 보기가 함께 쓴다.

const NO_TRACKS: WorldTrack[] = [];
const NO_CAMS: ReadonlySet<string> = new Set();

/** 모의 화면의 선 굵기와 글자 크기(SVG viewBox 단위). */
const GRID_STROKE = 0.3;
const ROOM_STROKE = 0.6;
const NO_SIGNAL_FONT = 7;

interface CamView {
  cam: CctvCam;
  project: CctvProjector;
  grid: string;
  room: string;
}

// 바닥 격자·방 테두리는 바뀌지 않으므로 한 번만 계산한다.
const VIEWS: readonly CamView[] = CCTV_CAMS.map((cam) => {
  const project = cctvProj(cam);
  return { cam, project, ...cctvBackdrop(project) };
});
const VIEW_IDS = VIEWS.map((view) => view.cam.id);
const VIEW_BY_ID = new Map(VIEWS.map((view) => [view.cam.id, view]));

const PILL =
  'pointer-events-none absolute top-2 rounded-md bg-slate-950/70 px-2 py-0.5 text-xs leading-[18px] text-slate-100';

/** 사람(평면 좌표)을 그 카메라에서 본 몸통·머리로 그린다. */
export function CctvFigures({
  project,
  people,
}: {
  project: CctvProjector;
  people: readonly CctvPerson[];
}) {
  return cctvFigures(project, people).map(({ id, body, head }) => (
    <g key={id}>
      <rect {...body} className="fill-slate-400" />
      <circle {...head} className="fill-slate-300" />
    </g>
  ));
}

/** 실시간 World 의 사람. world 가 올 때마다(10Hz) 이 층만 다시 그린다. */
function LivePeople({ project }: { project: CctvProjector }) {
  const tracks = useRealtimeStore((s) => s.world?.payload.tracks) ?? NO_TRACKS;
  return <CctvFigures project={project} people={cctvPeople(tracks)} />;
}

function NoSignal() {
  return (
    <g>
      <rect width={CCTV_W} height={CCTV_H} className="fill-slate-900" />
      <text
        x={CCTV_W / 2}
        y={CCTV_H / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={NO_SIGNAL_FONT}
        className="fill-slate-400"
      >
        신호 없음
      </text>
    </g>
  );
}

function Feed({
  view,
  down,
  frozen,
  figures,
}: {
  view: CamView;
  down: boolean;
  frozen: boolean;
  figures: (project: CctvProjector) => ReactNode;
}) {
  const sky = `cctv-sky-${view.cam.id}`;
  return (
    <svg
      viewBox={`0 0 ${CCTV_W} ${CCTV_H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`${cameraLabel(
        CCTV_CAMS.map((c) => c.id),
        view.cam.id,
      )} 영상`}
      className={cn('block size-full', frozen && DIMMED)}
    >
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" className="text-slate-800" />
          <stop offset="1" stopColor="currentColor" className="text-slate-700" />
        </linearGradient>
      </defs>
      <rect width={CCTV_W} height={CCTV_H} fill={`url(#${sky})`} />
      {down ? (
        <NoSignal />
      ) : (
        <g>
          <path d={view.grid} strokeWidth={GRID_STROKE} className="fill-none stroke-slate-600" />
          <path d={view.room} strokeWidth={ROOM_STROKE} className="fill-none stroke-slate-400" />
          {figures(view.project)}
        </g>
      )}
    </svg>
  );
}

/** EC2 시계. 1초마다 바뀌므로 이 글자만 다시 그린다. */
function LiveClock() {
  const now = useNow();
  const offset = useRealtimeStore((s) => s.health?.clockOffsetMs);
  return <>LIVE {clockLabel(offset, now) ?? '—'}</>;
}

/** 실시간 배지 글: LIVE 시계. World 가 멈췄을 때(정지)는 부르는 쪽이 배지를 두지 않는다(S15P31A101-665). */
export function LiveBadge() {
  return (
    <>
      <i aria-hidden className={LIVE_DOT} />
      <LiveClock />
    </>
  );
}

function Tile({
  view,
  focused,
  down,
  frozen,
  figures,
  badge,
  onToggle,
}: {
  view: CamView;
  focused: boolean;
  down: boolean;
  frozen: boolean;
  figures: (project: CctvProjector) => ReactNode;
  badge: ReactNode;
  onToggle: () => void;
}) {
  const { id, dir } = view.cam;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${cameraLabel(
        CCTV_CAMS.map((c) => c.id),
        id,
      )} ${focused ? '작게 보기' : '크게 보기'}`}
      className={cn(TILE_FRAME, 'bg-slate-900', tileZoom(focused))}
    >
      <Feed view={view} down={down} frozen={frozen} figures={figures} />
      <span className={cn(PILL, 'left-2')}>
        <b className="font-mono" title={id}>
          {cameraLabel(
            CCTV_CAMS.map((c) => c.id),
            id,
          )}
        </b>{' '}
        {dir} 모서리
      </span>
      {(down || badge != null) && (
        <span
          className={cn(
            PILL,
            'right-2 inline-flex items-center gap-1.5 font-mono',
            (down || frozen) && 'text-slate-400',
          )}
        >
          {down ? '끊김' : badge}
        </span>
      )}
    </button>
  );
}

interface CctvMockWallProps {
  /** 카메라마다 그릴 사람 층. 자주 바뀌는 사람은 이 층이 직접 구독하면 화면 틀을 다시 그리지 않는다. */
  figures: (project: CctvProjector) => ReactNode;
  /** 신호 없음으로 보일 카메라 id. */
  down?: ReadonlySet<string>;
  /** 그림이 멈췄다(흐리게). */
  frozen?: boolean;
  /** 각 칸 오른쪽 위 글(신호 없는 칸은 "끊김"). null 이면 신호 없는 칸 말고는 두지 않는다. */
  badge: ReactNode;
  /** 크게 볼 때 나머지 칸을 놓는 곳(CctvWall). */
  rest?: WallRest;
}

/** 2×2 모의 화면. 칸 배치(크게 보기 포함)는 CctvWall 이 하고, 이 컴포넌트는 칸 안의 그림을 채운다. */
export function CctvMockWall({
  figures,
  down = NO_CAMS,
  frozen = false,
  badge,
  rest,
}: CctvMockWallProps) {
  return (
    <CctvWall
      ids={VIEW_IDS}
      rest={rest}
      tile={(id, wall) => {
        const view = VIEW_BY_ID.get(id);
        return (
          view && (
            <Tile
              view={view}
              focused={wall.focused}
              down={down.has(id)}
              frozen={frozen}
              figures={figures}
              badge={badge}
              onToggle={wall.toggle}
            />
          )
        );
      }}
    />
  );
}

const livePeople = (project: CctvProjector) => <LivePeople project={project} />;

/** 실시간 CCTV 목 화면. health 카메라 상태가 정상이 아니면 그 칸은 신호 없음, World 가 끊기면 멈춤이다. */
export function CctvDemo() {
  const { fresh, stateOf } = useCameraStates();
  const down = new Set(CCTV_CAMS.filter((cam) => stateOf(cam.id) === 'down').map((cam) => cam.id));
  return (
    <CctvMockWall
      figures={livePeople}
      down={down}
      frozen={!fresh}
      badge={fresh ? <LiveBadge /> : null}
    />
  );
}

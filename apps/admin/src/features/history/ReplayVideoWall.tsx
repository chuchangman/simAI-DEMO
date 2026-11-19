import { CctvWall, type WallRest } from '@/features/cctv/CctvWall';
import { TILE_FRAME, tileZoom } from '@/features/cctv/tileStyle';
import { loadPlayableClip } from '@/features/clips/clipMedia';
import { formatTime } from '@/features/events/events';
import { requestVideoUrl } from '@/features/history/api';
import { syncTileVideo, tileVideos, type TileVideoRole } from '@/features/history/replaySegments';
import type { VideoSegment } from '@/features/history/types';
import { useReplayStatus } from '@/features/history/useWorkReplay';
import type { ReplaySpatialSource, ReplayStatus } from '@/features/viewer3d';
import { useCameraNames } from '@/hooks/useCameraNames';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { cn } from '@simai/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

const PILL =
  'absolute top-2 rounded-md bg-black/55 px-2 py-0.5 text-xs text-slate-100 backdrop-blur-[2px]';

type OnFailed = (segmentId: string, message?: string) => void;

/**
 * 조각 재생 주소(서명 주소는 5분). 이 칸이 떠 있는 동안만 받고, 칸이 사라지면 버린다. 영상 형식은 클립과 같은 규칙으로 읽는다
 * (게이트웨이 녹화는 mp4 라 서명 주소를 그대로 튼다, S15P31A101-668).
 */
function useSegmentSource(segment: VideoSegment) {
  const query = useQuery({
    queryKey: ['history', 'video-source', segment.segment_id],
    queryFn: async ({ signal }) => {
      const info = await requestVideoUrl(api, segment.segment_id, signal);
      return loadPlayableClip(
        { ...info, clip_id: info.segment_id },
        {
          clip_start_capture_ms: segment.segment_start_capture_ms,
          clip_end_capture_ms: segment.segment_end_capture_ms,
        },
        signal,
      );
    },
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const source = query.data;
  // 감싼 영상의 blob 주소는 새 영상으로 바뀌거나 칸이 사라질 때 해제한다.
  useEffect(() => () => source?.release(), [source]);
  const error = query.error;
  const errorLine =
    error instanceof ApiError && error.status === 403
      ? '영상 조회 권한이 없습니다.'
      : error instanceof ApiError && error.status === 401
        ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
        : error instanceof ApiError && error.status === 410
          ? '영상 보관 기간이 만료되었습니다.'
          : '영상을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.';
  return { url: source?.url, failed: query.isError, refetch: query.refetch, errorLine };
}

/**
 * 칸 하나의 영상 바꾸기. 첫 화면이 나온 조각 id 와 마지막으로 보인 조각을 들고, 그릴 영상들과 보일 조각을 고른다(tileVideos).
 * onReady 는 영상이 첫 화면을 냈을 때(true)와 비거나 사라졌을 때(false) 부른다.
 */
function useSegmentSwap(live: VideoSegment, upcoming: VideoSegment | undefined) {
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const [held, setHeld] = useState<VideoSegment | null>(null);
  // 지금 조각이 첫 화면을 내면 그 조각이 마지막으로 보인 조각이 된다(그리는 중에 맞춰 이전 조각을 한 번 더 그리지 않는다)
  if (ready.has(live.segment_id) && held?.segment_id !== live.segment_id) setHeld(live);
  const onReady = useCallback((segmentId: string, isReady: boolean) => {
    setReady((current) => {
      if (current.has(segmentId) === isReady) return current;
      const next = new Set(current);
      if (isReady) next.add(segmentId);
      else next.delete(segmentId);
      return next;
    });
  }, []);
  return { ...tileVideos(live, held, upcoming, ready), onReady };
}

/** 칸 안 영상 하나. 맡은 일(role)대로 재생 시각을 따르거나 멈춰 두고, 보일 때만 불투명하다. */
function SegmentVideo({
  segment,
  role,
  status,
  shown,
  onReady,
  onFailed,
}: {
  segment: VideoSegment;
  role: TileVideoRole;
  status: ReplayStatus;
  shown: boolean;
  onReady: (segmentId: string, isReady: boolean) => void;
  onFailed?: OnFailed;
}) {
  const { url, failed, refetch, errorLine } = useSegmentSource(segment);
  const video = useRef<HTMLVideoElement>(null);
  const segmentId = segment.segment_id;
  // 서명 주소가 만료돼(5분) 이어 받기가 막히면 <video> 가 오류를 낸다. 주소를 한 번 다시 받아 같은 재생 시각으로 잇고, 그래도 안 되면 뺀다.
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    if (video.current && url) syncTileVideo(video.current, segment, role, status);
  }, [segment, role, status, url]);

  useEffect(() => () => onReady(segmentId, false), [segmentId, onReady]);

  // 주소를 받지 못했으면 이 조각은 뺀다(남은 조각이 없으면 3D 다시 보기로 돌아간다).
  useEffect(() => {
    if (failed) onFailed?.(segmentId, errorLine);
  }, [failed, onFailed, segmentId, errorLine]);

  const onVideoError = () => {
    if (renewed) {
      onFailed?.(
        segmentId,
        '영상을 재생하지 못했습니다. 네트워크 연결 또는 영상 형식을 확인해 주세요.',
      );
      return;
    }
    setRenewed(true);
    void refetch();
  };

  if (!url || failed) return null;
  return (
    <video
      ref={video}
      src={url}
      muted
      playsInline
      preload="auto"
      // 영상은 재생 시각이 끌고 간다. 영상 안의 위치가 아니라 기록의 시각이 기준이다.
      onLoadedMetadata={() => {
        // 새 주소로 다시 읽혔으면 다음 만료 때 또 한 번 다시 받을 수 있다
        setRenewed(false);
        if (video.current) syncTileVideo(video.current, segment, role, status);
      }}
      onLoadedData={() => onReady(segmentId, true)}
      onEmptied={() => onReady(segmentId, false)}
      onError={onVideoError}
      className={cn('absolute inset-0 size-full object-cover', !shown && 'opacity-0')}
    />
  );
}

function SegmentTile({
  segment,
  upcoming,
  replay,
  focused,
  onToggle,
  onFailed,
  label,
}: {
  segment: VideoSegment;
  upcoming: VideoSegment | undefined;
  replay: ReplaySpatialSource | null;
  focused: boolean;
  onToggle: () => void;
  onFailed?: OnFailed;
  label: string;
}) {
  const status = useReplayStatus(replay);
  const { videos, shownId, onReady } = useSegmentSwap(segment, upcoming);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${label} ${focused ? '작게 보기' : '크게 보기'}`}
      className={cn(TILE_FRAME, 'bg-slate-900', tileZoom(focused))}
    >
      {videos.map((video) => (
        <SegmentVideo
          key={video.segment.segment_id}
          segment={video.segment}
          role={video.role}
          status={status}
          shown={video.segment.segment_id === shownId}
          onReady={onReady}
          onFailed={onFailed}
        />
      ))}
      {shownId === null && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          영상을 불러오는 중입니다…
        </span>
      )}
      <span className={cn(PILL, 'left-2 font-mono font-bold')} title={segment.camera_id}>
        {label}
      </span>
      <span className={cn(PILL, 'right-2 font-mono')}>
        {status.playhead !== null ? formatTime(status.playhead) : ''}
      </span>
    </button>
  );
}

/**
 * 재생 시각을 덮는 영상 조각을 카메라 칸마다 튼다(CCTV 영상). 칸을 누르면 크게 본다.
 * upcoming(곧 덮을 조각)은 칸마다 미리 올려 두었다가 조각 경계에서 검은 화면 없이 바꾼다.
 * 조각 영상을 끝내 받지 못하면 onFailed 로 알린다(부르는 쪽이 그 조각을 빼고, 남은 게 없으면 3D 다시 보기로 돌아간다).
 */
export function ReplayVideoWall({
  segments,
  upcoming,
  replay,
  onFailed,
  rest,
}: {
  segments: readonly VideoSegment[];
  upcoming: readonly VideoSegment[];
  replay: ReplaySpatialSource | null;
  onFailed?: OnFailed;
  /** 크게 볼 때 나머지 칸을 놓는 곳(CctvWall). */
  rest?: WallRest;
}) {
  const label = useCameraNames(segments.map((segment) => segment.camera_id));
  const byCamera = new Map(segments.map((segment) => [segment.camera_id, segment]));
  const nextByCamera = new Map(upcoming.map((segment) => [segment.camera_id, segment]));
  return (
    <CctvWall
      ids={[...byCamera.keys()]}
      rest={rest}
      tile={(id, wall) => {
        const segment = byCamera.get(id);
        return (
          segment && (
            <SegmentTile
              segment={segment}
              upcoming={nextByCamera.get(id)}
              label={label(segment.camera_id)}
              replay={replay}
              focused={wall.focused}
              onToggle={wall.toggle}
              onFailed={onFailed}
            />
          )
        );
      }}
    />
  );
}

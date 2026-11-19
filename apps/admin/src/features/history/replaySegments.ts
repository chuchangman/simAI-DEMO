import type { VideoSegment } from '@/features/history/types';
import type { ReplayStatus } from '@/features/viewer3d';

// 다시 보기에서 CCTV 칸에 상시 영상 조각을 틀기 위한 계산. 화면 없이 시험한다.

/** 재생 중 영상이 재생 시각과 이만큼(초) 넘게 어긋나면 위치를 다시 맞춘다. 매 tick 마다 맞추면 영상이 끊긴다. */
export const DRIFT_S = 0.5;

/**
 * 멈춤 중에는 한 프레임(25 fps, 40 ms)보다 어긋나면 맞춘다. 멈춘 화면을 3D 다시 보기와 견줘 볼 때 같은 프레임이어야 한다
 * (게이트웨이 녹화 mp4 는 PTS 가 촬영 시각이라 currentTime 이 그대로 그 시각의 프레임이다, S15P31A101-668).
 */
export const PAUSED_DRIFT_S = 0.04;

/** <video> 가 받는 재생 속도 범위. 넘는 배속은 가까운 값으로 둔다. */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

/**
 * 같은 카메라의 조각 사이 틈이 이보다 짧으면 이어진 것으로 본다. 녹화 조각 경계에는 1~17 ms 틈이 있어, 재생 시각(0.1초 단위)이
 * 그 틈에 걸리면 칸이 빠졌다 돌아오며 4분할 배치가 흔들렸다.
 */
export const SEGMENT_GAP_MS = 500;

/** 곧 덮을 조각을 미리 올려 두는 시간(실제 시간, ms). 조각 영상이 첫 화면을 내는 데 0.3~0.6초 걸린다(2026-11-16 실측). */
export const PRELOAD_LEAD_MS = 5_000;

/**
 * 재생 시각을 덮는 조각. 카메라마다 가장 늦게 시작한 것 하나이고, 지운 조각은 뺀다. 카메라 이름순이다.
 * 끝 시각 뒤 SEGMENT_GAP_MS 안이면 그 조각이 그대로 덮는다(다음 조각이 시작하면 늦게 시작한 쪽이 이긴다).
 */
export function activeSegments(segments: readonly VideoSegment[], playhead: number | null) {
  if (playhead === null) return [];
  const latest = new Map<string, VideoSegment>();
  for (const segment of segments) {
    if (segment.deleted_at_ms != null) continue;
    if (
      playhead < segment.segment_start_capture_ms ||
      playhead >= segment.segment_end_capture_ms + SEGMENT_GAP_MS
    ) {
      continue;
    }
    const held = latest.get(segment.camera_id);
    if (!held || segment.segment_start_capture_ms > held.segment_start_capture_ms) {
      latest.set(segment.camera_id, segment);
    }
  }
  return [...latest.values()].sort((a, b) => a.camera_id.localeCompare(b.camera_id));
}

/**
 * 미리 올릴 조각을 고르는 기록 시각(이 시각을 덮는 조각을 미리 올린다). 배속이면 같은 실제 시간 동안 기록이 더 지나가므로
 * 그만큼 더 앞을 본다.
 */
export function preloadAt(status: Pick<ReplayStatus, 'playhead' | 'speed'>): number | null {
  if (status.playhead === null) return null;
  return status.playhead + PRELOAD_LEAD_MS * Math.max(1, status.speed);
}

/** 조각 안의 재생 위치(초). */
export const segmentOffsetS = (segment: VideoSegment, playhead: number) =>
  (playhead - segment.segment_start_capture_ms) / 1000;

/** <video> 중 이 계산이 읽고 쓰는 칸. */
export interface VideoLike {
  currentTime: number;
  /** 영상 길이(초). 메타데이터를 읽기 전이면 NaN 이다. */
  readonly duration: number;
  /** 끝까지 틀어 멈췄다. 이때 play() 는 처음부터 다시 튼다. */
  readonly ended: boolean;
  playbackRate: number;
  paused: boolean;
  play: () => Promise<void>;
  pause: () => void;
}

type SyncStatus = Pick<ReplayStatus, 'playhead' | 'playing' | 'speed'>;

/**
 * 영상을 재생 시각·재생 중·배속에 맞춘다. 기록이 비어 시각이 없으면 두고 본다. 오차는 재생 중 DRIFT_S, 멈춤 중 PAUSED_DRIFT_S 이내다.
 * 재생 시각이 영상 끝을 넘었으면(조각 사이 틈, 녹화 끝) 마지막 프레임에 두고 다시 틀지 않는다(처음 장면이 번쩍이지 않게).
 */
export function syncVideo(video: VideoLike, segment: VideoSegment, status: SyncStatus): void {
  if (status.playhead === null) return;
  const offset = segmentOffsetS(segment, status.playhead);
  const target = Number.isFinite(video.duration) ? Math.min(offset, video.duration) : offset;
  const drift = status.playing ? DRIFT_S : PAUSED_DRIFT_S;
  if (Math.abs(video.currentTime - target) > drift) video.currentTime = target;
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, status.speed));
  if (video.playbackRate !== rate) video.playbackRate = rate;
  if (status.playing && video.paused && !video.ended) video.play().catch(() => {});
  else if (!status.playing && !video.paused) video.pause();
}

/**
 * 칸 안 영상 하나가 맡은 일. live 는 재생 시각을 따른다. held 는 다음 영상이 첫 화면을 낼 때까지 멈춘 채 보인다.
 * standby 는 곧 덮을 조각을 시작 위치에 멈춰 미리 받아 둔다.
 */
export type TileVideoRole = 'live' | 'held' | 'standby';

/** 칸 안 영상 하나를 맡은 일대로 맞춘다. */
export function syncTileVideo(
  video: VideoLike,
  segment: VideoSegment,
  role: TileVideoRole,
  status: SyncStatus,
): void {
  if (role === 'held') {
    if (!video.paused) video.pause();
    return;
  }
  const at =
    role === 'live'
      ? status
      : { playhead: segment.segment_start_capture_ms, playing: false, speed: status.speed };
  syncVideo(video, segment, at);
}

export interface TileVideo {
  segment: VideoSegment;
  role: TileVideoRole;
}

/**
 * 카메라 칸 하나에 그릴 영상들과 보일 조각. 지금 조각(live)이 첫 화면을 낼 때까지 마지막으로 보이던 조각(held)을 보여 칸이
 * 검게 비지 않게 하고, 곧 덮을 조각(upcoming)은 미리 올려 경계에서 바로 바꾼다. ready 는 첫 화면이 나온 조각 id 다.
 * 같은 조각은 하나만, 시작 시각 순으로 둔다(맡은 일이 바뀌어도 <video> 순서가 그대로라 옮겨지지 않는다).
 */
export function tileVideos(
  live: VideoSegment,
  held: VideoSegment | null,
  upcoming: VideoSegment | undefined,
  ready: ReadonlySet<string>,
): { videos: TileVideo[]; shownId: string | null } {
  const videos: TileVideo[] = [{ segment: live, role: 'live' }];
  const add = (segment: VideoSegment | null | undefined, role: TileVideoRole) => {
    if (segment && videos.every((video) => video.segment.segment_id !== segment.segment_id)) {
      videos.push({ segment, role });
    }
  };
  add(held, 'held');
  add(upcoming, 'standby');
  videos.sort((a, b) => a.segment.segment_start_capture_ms - b.segment.segment_start_capture_ms);
  const shown = ready.has(live.segment_id)
    ? live
    : held && ready.has(held.segment_id)
      ? held
      : null;
  return { videos, shownId: shown?.segment_id ?? null };
}

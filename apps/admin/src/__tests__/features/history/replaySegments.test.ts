import {
  activeSegments,
  DRIFT_S,
  PAUSED_DRIFT_S,
  PRELOAD_LEAD_MS,
  preloadAt,
  SEGMENT_GAP_MS,
  segmentOffsetS,
  syncTileVideo,
  syncVideo,
  tileVideos,
  type VideoLike,
} from '@/features/history/replaySegments';
import { videoSegmentsSchema, type VideoSegment } from '@/features/history/types';
import { describe, expect, it, vi } from 'vitest';

const T = 1_760_342_400_000;

function segment(change: Partial<VideoSegment> = {}): VideoSegment {
  return {
    segment_id: 's-1',
    camera_id: 'cam_A',
    segment_start_capture_ms: T,
    segment_end_capture_ms: T + 60_000,
    ...change,
  };
}

describe('videoSegmentsSchema', () => {
  it('형식이 틀린 조각 하나는 빼고 나머지를 보인다', () => {
    const parsed = videoSegmentsSchema.parse({
      segments: [
        { ...segment(), container: 'mp4', content_type: 'video/mp4', size_bytes: 1 },
        { segment_id: 'broken' },
      ],
    });
    expect(parsed.segments.map((s) => s.segment_id)).toEqual(['s-1']);
  });
});

describe('activeSegments', () => {
  it('재생 시각을 덮는 조각만 카메라 이름순으로 준다(끝 시각 뒤 짧은 틈까지 덮는다)', () => {
    const segments = [
      segment({ segment_id: 'b', camera_id: 'cam_B' }),
      segment({ segment_id: 'a', camera_id: 'cam_A' }),
      segment({
        segment_id: 'later',
        camera_id: 'cam_C',
        segment_start_capture_ms: T + 60_000,
        segment_end_capture_ms: T + 120_000,
      }),
    ];
    expect(activeSegments(segments, T + 10_000).map((s) => s.segment_id)).toEqual(['a', 'b']);
    expect(activeSegments(segments, T).map((s) => s.segment_id)).toEqual(['a', 'b']);
    expect(activeSegments(segments, T + 60_000).map((s) => s.segment_id)).toEqual([
      'a',
      'b',
      'later',
    ]);
    expect(activeSegments(segments, T + 60_000 + SEGMENT_GAP_MS).map((s) => s.segment_id)).toEqual([
      'later',
    ]);
    expect(activeSegments(segments, T - 1)).toEqual([]);
  });

  it('조각 사이 짧은 틈(녹화 경계 1~17 ms)에서는 앞 조각을 그대로 두어 칸이 빠지지 않는다', () => {
    const segments = [
      segment({ segment_id: 'p1', segment_end_capture_ms: T + 30_000 }),
      segment({
        segment_id: 'p2',
        segment_start_capture_ms: T + 30_017,
        segment_end_capture_ms: T + 60_000,
      }),
    ];
    expect(activeSegments(segments, T + 30_005).map((s) => s.segment_id)).toEqual(['p1']);
    expect(activeSegments(segments, T + 30_017).map((s) => s.segment_id)).toEqual(['p2']);
  });

  it('틈이 SEGMENT_GAP_MS 이상이면 그 동안은 덮지 않는다', () => {
    const segments = [segment({ segment_end_capture_ms: T + 30_000 })];
    expect(activeSegments(segments, T + 30_000 + SEGMENT_GAP_MS - 1)).toHaveLength(1);
    expect(activeSegments(segments, T + 30_000 + SEGMENT_GAP_MS)).toEqual([]);
  });

  it('1분 조각이 이어지면 경계에서 다음 조각으로 넘어간다', () => {
    const segments = [
      segment({ segment_id: 'm1' }),
      segment({
        segment_id: 'm2',
        segment_start_capture_ms: T + 60_000,
        segment_end_capture_ms: T + 120_000,
      }),
    ];
    expect(activeSegments(segments, T + 59_999).map((s) => s.segment_id)).toEqual(['m1']);
    expect(activeSegments(segments, T + 60_000).map((s) => s.segment_id)).toEqual(['m2']);
  });

  it('같은 카메라에 겹치면 더 늦게 시작한 조각을, 지운 조각은 뺀다', () => {
    const segments = [
      segment({ segment_id: 'old' }),
      segment({
        segment_id: 'new',
        segment_start_capture_ms: T + 20_000,
        segment_end_capture_ms: T + 80_000,
      }),
      segment({ segment_id: 'gone', camera_id: 'cam_B', deleted_at_ms: T }),
    ];
    expect(activeSegments(segments, T + 30_000).map((s) => s.segment_id)).toEqual(['new']);
  });

  it('재생 시각이 없으면(기록이 비었음) 없다', () => {
    expect(activeSegments([segment()], null)).toEqual([]);
  });
});

const video = (change: Partial<VideoLike> = {}): VideoLike => ({
  currentTime: 0,
  duration: 60,
  ended: false,
  playbackRate: 1,
  paused: true,
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  ...change,
});

describe('syncVideo', () => {
  it('조각 안의 위치는 재생 시각에서 조각 시작을 뺀 값이다', () => {
    expect(segmentOffsetS(segment(), T + 12_500)).toBe(12.5);
  });

  it('재생 중 어긋남이 허용 안이면 위치를 두고, 넘으면 다시 맞춘다', () => {
    const near = video({ currentTime: 10, paused: false });
    syncVideo(near, segment(), {
      playhead: T + 10_000 + DRIFT_S * 1000 - 1,
      playing: true,
      speed: 1,
    });
    expect(near.currentTime).toBe(10);

    const far = video({ currentTime: 10 });
    syncVideo(far, segment(), { playhead: T + 20_000, playing: false, speed: 1 });
    expect(far.currentTime).toBe(20);
  });

  it('멈춤 중에는 한 프레임(40 ms)보다 어긋나면 그 시각으로 맞춘다(3D 다시 보기와 같은 프레임)', () => {
    const near = video({ currentTime: 10 });
    syncVideo(near, segment(), {
      playhead: T + 10_000 + PAUSED_DRIFT_S * 1000 - 1,
      playing: false,
      speed: 1,
    });
    expect(near.currentTime).toBe(10);

    const off = video({ currentTime: 10 });
    syncVideo(off, segment(), { playhead: T + 10_200, playing: false, speed: 1 });
    expect(off.currentTime).toBeCloseTo(10.2);
  });

  it('녹화 mp4(PTS = 촬영 시각 − 조각 시작)는 빠진 프레임 뒤에서도 재생 시각 그대로의 위치다', () => {
    // 게이트웨이 조각(S15P31A101-668): 조각 시작 = 첫 프레임 촬영 시각이라 위치 = 재생 시각 − 조각 시작
    const recording = segment({ segment_start_capture_ms: T + 400, origin: 'GATEWAY_RECORDING' });
    const v = video({ currentTime: 0 });
    syncVideo(v, recording, { playhead: T + 1_600, playing: false, speed: 1 });
    expect(v.currentTime).toBeCloseTo(1.2);
  });

  it('재생 중이면 틀고 멈추면 세우고, 배속을 맞춘다', () => {
    const v = video();
    syncVideo(v, segment(), { playhead: T, playing: true, speed: 4 });
    expect(v.play).toHaveBeenCalledTimes(1);
    expect(v.playbackRate).toBe(4);

    const playing = video({ paused: false });
    syncVideo(playing, segment(), { playhead: T, playing: false, speed: 1 });
    expect(playing.pause).toHaveBeenCalledTimes(1);
  });

  it('영상이 받는 배속 범위로 자른다', () => {
    const fast = video();
    syncVideo(fast, segment(), { playhead: T, playing: false, speed: 100 });
    expect(fast.playbackRate).toBe(16);
    const slow = video();
    syncVideo(slow, segment(), { playhead: T, playing: false, speed: 0.001 });
    expect(slow.playbackRate).toBe(0.0625);
  });

  it('재생이 막혀도(자동 재생 정책) 오류를 던지지 않는다', async () => {
    const v = video({ play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))) });
    expect(() => syncVideo(v, segment(), { playhead: T, playing: true, speed: 1 })).not.toThrow();
    await Promise.resolve();
  });

  it('재생 시각이 없으면 아무것도 건드리지 않는다', () => {
    const v = video({ currentTime: 3 });
    syncVideo(v, segment(), { playhead: null, playing: true, speed: 2 });
    expect(v.currentTime).toBe(3);
    expect(v.play).not.toHaveBeenCalled();
  });

  it('재생 시각이 영상 끝을 넘으면 마지막 프레임에 두고, 끝난 영상은 다시 틀지 않는다(처음 장면이 번쩍이지 않게)', () => {
    const v = video({ currentTime: 29.96, duration: 29.96, ended: true });
    syncVideo(v, segment(), { playhead: T + 30_010, playing: true, speed: 1 });
    expect(v.currentTime).toBe(29.96);
    expect(v.play).not.toHaveBeenCalled();
  });

  it('메타데이터 전(길이 NaN)이면 재생 시각 그대로 맞춘다', () => {
    const v = video({ duration: Number.NaN });
    syncVideo(v, segment(), { playhead: T + 12_000, playing: false, speed: 1 });
    expect(v.currentTime).toBe(12);
  });
});

describe('preloadAt', () => {
  it('재생 시각에서 PRELOAD_LEAD_MS 앞, 배속이면 그만큼 더 앞이다(느린 배속은 줄이지 않는다)', () => {
    expect(preloadAt({ playhead: T, speed: 1 })).toBe(T + PRELOAD_LEAD_MS);
    expect(preloadAt({ playhead: T, speed: 4 })).toBe(T + PRELOAD_LEAD_MS * 4);
    expect(preloadAt({ playhead: T, speed: 0.5 })).toBe(T + PRELOAD_LEAD_MS);
    expect(preloadAt({ playhead: null, speed: 1 })).toBeNull();
  });
});

describe('syncTileVideo', () => {
  const status = { playhead: T + 10_000, playing: true, speed: 2 };

  it('live 는 재생 시각을 따른다', () => {
    const v = video();
    syncTileVideo(v, segment(), 'live', status);
    expect(v.currentTime).toBe(10);
    expect(v.play).toHaveBeenCalledTimes(1);
  });

  it('standby 는 조각 시작에 멈춰 두고 배속만 맞춘다', () => {
    const v = video({ currentTime: 3 });
    syncTileVideo(v, segment({ segment_start_capture_ms: T + 20_000 }), 'standby', status);
    expect(v.currentTime).toBe(0);
    expect(v.playbackRate).toBe(2);
    expect(v.play).not.toHaveBeenCalled();
  });

  it('held 는 멈춘 채 둔다', () => {
    const v = video({ currentTime: 29.9, paused: false });
    syncTileVideo(v, segment(), 'held', status);
    expect(v.pause).toHaveBeenCalledTimes(1);
    expect(v.currentTime).toBe(29.9);
  });
});

describe('tileVideos', () => {
  const s1 = segment({ segment_id: 's1', segment_end_capture_ms: T + 30_000 });
  const s2 = segment({
    segment_id: 's2',
    segment_start_capture_ms: T + 30_000,
    segment_end_capture_ms: T + 60_000,
  });
  const s3 = segment({
    segment_id: 's3',
    segment_start_capture_ms: T + 60_000,
    segment_end_capture_ms: T + 90_000,
  });
  const roles = (result: ReturnType<typeof tileVideos>) =>
    result.videos.map((v) => `${v.segment.segment_id}:${v.role}`);

  it('지금 조각이 첫 화면을 내기 전에는 마지막으로 보이던 조각을 보인다', () => {
    const result = tileVideos(s2, s1, undefined, new Set(['s1']));
    expect(result.shownId).toBe('s1');
    expect(roles(result)).toEqual(['s1:held', 's2:live']);
  });

  it('지금 조각이 첫 화면을 내면 그 조각을 보이고, 곧 덮을 조각은 시작 시각 순으로 미리 올린다', () => {
    const result = tileVideos(s2, s1, s3, new Set(['s1', 's2']));
    expect(result.shownId).toBe('s2');
    expect(roles(result)).toEqual(['s1:held', 's2:live', 's3:standby']);
  });

  it('같은 조각은 하나만 둔다', () => {
    expect(roles(tileVideos(s1, s1, s1, new Set(['s1'])))).toEqual(['s1:live']);
  });

  it('보인 적 없고 첫 화면도 아직이면 보일 조각이 없다', () => {
    expect(tileVideos(s1, null, s2, new Set()).shownId).toBeNull();
  });
});

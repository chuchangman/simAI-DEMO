import { parseAnnexB } from '@/features/clips/h264';
import { muxAvcMp4Parts } from '@/features/clips/mp4';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { buildTestH264Stream } from '@/mocks/h264TestStream';
import { historyWorks } from '@/mocks/history';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { http, HttpResponse } from 'msw/http';

// 관제 녹화 작업 구간 영상 mock(S15P31A101-668, docs/design/S15P31A101-668-recording-s3-playback.md).
// 서버는 관제가 끝난 뒤 게이트웨이가 올린 mp4 조각을 상시 영상 조각 목록(GET /api/videos)에 origin GATEWAY_RECORDING 으로 낸다.
// 여기서는 끝난 작업마다 작업 구간을 카메라 4대 × 5분 조각으로 나눈 목록을 만들고, 재생 주소(GET /api/videos/:id)는
// 시험 H.264 스트림을 브라우저에서 mp4 로 감싼 blob 주소를 준다(영상 파일은 저장소에 두지 않는다). 시험 영상은 조각보다 짧아
// 끝에서 마지막 프레임에 멈춘다.

const CAMERAS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'] as const;
const SEGMENT_MS = 5 * 60_000;
const RETENTION_MS = 14 * 86_400_000;
/** 서명 주소 수명(서버 download-ttl 5분과 같다). */
const URL_TTL_MS = 5 * 60_000;
/** 서버 한도(VideoController): 24시간 이내. */
const MAX_RANGE_MS = 86_400_000;
const TEST_FRAMES = 250;

export interface MockRecordingSegment {
  segment_id: string;
  gateway_id: string;
  camera_id: string;
  segment_start_capture_ms: number;
  segment_end_capture_ms: number;
  frame_count: number;
  starts_with_keyframe: boolean;
  has_gaps: boolean;
  content_type: string;
  container: string;
  size_bytes: number;
  delete_after_ms: number;
  deleted_at_ms: number | null;
  origin: 'GATEWAY_RECORDING';
}

/** 끝난 작업의 작업 구간(실제 시작 → 실제 종료)을 카메라마다 5분 조각으로 나눈다. */
export function recordingSegments(
  works: readonly {
    work_id: string;
    actual_started_at: number | null;
    actual_ended_at: number | null;
  }[],
): MockRecordingSegment[] {
  return works.flatMap((work) => {
    const from = work.actual_started_at;
    const to = work.actual_ended_at;
    if (from == null || to == null || to <= from) return [];
    const out: MockRecordingSegment[] = [];
    for (let start = from; start < to; start += SEGMENT_MS) {
      const end = Math.min(start + SEGMENT_MS, to);
      for (const camera of CAMERAS) {
        out.push({
          segment_id: `rec-${work.work_id}-${camera}-${start}`,
          gateway_id: 'laptop-01',
          camera_id: camera,
          segment_start_capture_ms: start,
          segment_end_capture_ms: end,
          frame_count: Math.round((end - start) / 40),
          starts_with_keyframe: true,
          has_gaps: false,
          content_type: 'video/mp4',
          container: 'mp4',
          size_bytes: 40_000_000,
          delete_after_ms: start + RETENTION_MS,
          deleted_at_ms: null,
          origin: 'GATEWAY_RECORDING',
        });
      }
    }
    return out;
  });
}

let mp4Url: string | undefined;
/** 시험 스트림을 mp4 로 감싼 blob 주소(한 번 만들어 페이지가 열려 있는 동안 쓴다). */
function testMp4(): string {
  if (!mp4Url) {
    const { data } = buildTestH264Stream({ frames: TEST_FRAMES });
    const parts = muxAvcMp4Parts(parseAnnexB(data), { frameRate: 25 });
    mp4Url = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
  }
  return mp4Url;
}

/**
 * GET /api/videos(관리자, 구간이 겹치는 조각, 주소 없음)와 GET /api/videos/:id(서명 주소 대신 blob 주소).
 * liveWorks 는 히스토리 mock 과 같이 오늘 작업을 TBM 목에서 받는다.
 */
export function createRecordingVideoMock({
  now = Date.now,
  liveWorks,
  video = testMp4,
}: { now?: () => number; liveWorks?: () => readonly TbmWorkUnit[]; video?: () => string } = {}) {
  const admin = (request: Request) => {
    const user = readLiveUser(request, now());
    if (!user) return unauthorized();
    return user.role === 'ADMIN' ? undefined : problem(403, 'FORBIDDEN', '권한이 없습니다');
  };
  const all = () => recordingSegments(historyWorks(now(), liveWorks?.()));
  const handlers = [
    http.get('*/api/videos', ({ request }) => {
      const refused = admin(request);
      if (refused) return refused;
      const url = new URL(request.url);
      const from = Number(url.searchParams.get('from'));
      const to = Number(url.searchParams.get('to'));
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > MAX_RANGE_MS) {
        return problem(400, 'INVALID_VIDEO_QUERY', '조회 시각이 맞지 않습니다');
      }
      const camera = url.searchParams.get('camera_id');
      const segments = all().filter(
        (s) =>
          s.segment_start_capture_ms <= to &&
          s.segment_end_capture_ms >= from &&
          (!camera || s.camera_id === camera),
      );
      return HttpResponse.json({ from, to, segments });
    }),
    http.get('*/api/videos/:id', ({ params, request }) => {
      const refused = admin(request);
      if (refused) return refused;
      const found = all().find((s) => s.segment_id === String(params.id));
      if (!found) return problem(404, 'SEGMENT_NOT_FOUND', '영상 조각을 찾을 수 없습니다');
      return HttpResponse.json({
        segment_id: found.segment_id,
        url: video(),
        expires_at_ms: now() + URL_TTL_MS,
        content_type: found.content_type,
        container: found.container,
      });
    }),
  ];
  return { handlers };
}

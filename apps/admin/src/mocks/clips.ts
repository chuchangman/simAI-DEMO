import { CLIP_ERROR, CONTAINER_ANNEXB } from '@/features/clips/constants';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { testClipVideo } from '@/mocks/testClipVideo';
import type { RiskEventPayload } from '@simai/contracts';
import { http, HttpResponse } from 'msw/http';

// 서버 클립 API(BE 곽나혁, docs/design/server-event-clips.md) 대신 쓰는 mock. 응답 형식은 실제 서버(ClipService)와 같다.
// 시나리오의 LIVE CRITICAL·HIGH 이벤트마다 카메라 3대의 클립을 만든다. 클립은 위험 구간(앞뒤 20초)이 끝나고 올라간 뒤에야
// 목록에 생긴다. 영상은 서버처럼 변환하지 않은 원본(`video/h264`·`h264-annexb`)이고, 사람이 없는 시험 패턴을 코드로 만든다.
// 보관 기간(14일)이 지난 보존 없는 클립은 deleted_at_ms 가 차고 재생 주소는 410 CLIP_DELETED 다.

const PRE_MS = 20_000;
const POST_MS = 20_000;
/** 위험 구간이 끝난 뒤 올라가기까지(ms). 카메라마다 조금씩 늦다. */
const UPLOAD_MS = 4_000;
/** 카메라 번호가 하나 늘 때마다 더 늦어지는 업로드 시간(ms). */
const UPLOAD_STAGGER_MS = 1_500;
/** 위험 구간이 끝난 뒤 서버가 클립을 만들기까지(ms). */
const CREATE_DELAY_MS = 500;
const CAMERAS = ['cam_A', 'cam_B', 'cam_C'] as const;
/** 링 버퍼에 앞부분이 없어 첫 구간이 늦게 시작하는 카메라와 그 늦는 시간(ms). */
const TRUNCATED_CAMERA = 'cam_B';
const TRUNCATED_START_MS = 6_000;
/** 구간 안에 프레임 빈칸이 있는 카메라. */
const GAPPED_CAMERA = 'cam_C';
/** 시험 영상의 프레임 속도와 프레임당 크기(바이트). */
const FPS = 15;
const BYTES_PER_FRAME = 800;
/** 재생 주소 만료(ms). 서버의 서명 주소와 같은 5분이다. */
const URL_TTL_MS = 5 * 60_000;
/** 보관 기간(명세 11.5, 14일). */
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
/** 클립 id 의 앞부분(UUID v7 모양). 뒤 12글자는 발급 순서다. */
const CLIP_ID_PREFIX = '0192a6f1-7c1e-7d3a-9f2d-';
const CLIP_ID_SEQUENCE_LENGTH = 12;

type Camera = (typeof CAMERAS)[number];

const frameCountOf = (start: number, end: number) => Math.round(((end - start) / 1000) * FPS);

/** 클립의 촬영 구간과 올라간 시각. cam_B 의 첫 구간은 앞부분이 없어 늦게 시작한다. */
function windowOf(anchor: number, resume: number, camera: Camera) {
  const truncatedStart = camera === TRUNCATED_CAMERA && resume === 0;
  const start = anchor - PRE_MS + (truncatedStart ? TRUNCATED_START_MS : 0);
  const end = anchor + POST_MS;
  const uploaded = end + UPLOAD_MS + CAMERAS.indexOf(camera) * UPLOAD_STAGGER_MS;
  return { truncatedStart, start, end, uploaded };
}

export interface ClipsMock {
  /** GET /api/events/:id/clips, GET /api/clips/:id, PUT /api/clips/:id/retention */
  handlers: (ReturnType<typeof http.get> | ReturnType<typeof http.put>)[];
}

export function createClipsMock({
  findEvent,
  now = Date.now,
  video = testClipVideo,
}: {
  /** 이벤트 mock 저장소의 이벤트(events.find). */
  findEvent: (eventId: string) => RiskEventPayload | undefined;
  now?: () => number;
  /** 재생할 영상 주소(프레임 수를 받는다). 기본은 코드로 만든 시험 패턴이다. */
  video?: (frames: number) => string | Promise<string>;
}): ClipsMock {
  /** 위험 구간(재개 횟수)마다 기준 시각. 처음 발생은 발생 시각, 재개는 그것을 처음 본 갱신 시각이다. */
  const anchors = new Map<string, number[]>();
  /** 관리자가 바꾼 보존 표시. */
  const held = new Map<string, boolean>();
  const ids = new Map<string, string>();
  const index = new Map<string, { eventId: string; resume: number; camera: Camera }>();
  let issued = 0;

  const clipIdOf = (eventId: string, resume: number, camera: Camera) => {
    const key = `${eventId}/${resume}/${camera}`;
    let id = ids.get(key);
    if (!id) {
      id = `${CLIP_ID_PREFIX}${(++issued).toString(16).padStart(CLIP_ID_SEQUENCE_LENGTH, '0')}`;
      ids.set(key, id);
      index.set(id, { eventId, resume, camera });
    }
    return id;
  };

  function anchorsOf(event: RiskEventPayload): number[] {
    const list = anchors.get(event.event_id) ?? [event.raised_at ?? now()];
    while (list.length <= (event.resume_count ?? 0)) list.push(event.updated_at ?? now());
    anchors.set(event.event_id, list);
    return list;
  }

  function clipOf(event: RiskEventPayload, resume: number, camera: Camera, t: number) {
    const anchor = anchorsOf(event)[resume];
    if (anchor === undefined) return undefined;
    const { truncatedStart, start, end, uploaded } = windowOf(anchor, resume, camera);
    if (t < uploaded) return undefined;
    const clipId = clipIdOf(event.event_id, resume, camera);
    const created = end + CREATE_DELAY_MS;
    const critical = event.severity === 'CRITICAL';
    // CRITICAL 이벤트에 연결된 클립은 자동 보존이다(명세 11.5). 관리자가 붙인 표시는 껐다 켤 수 있다.
    const hold = critical || held.get(clipId) === true;
    const deleteAfter = created + KEEP_MS;
    const frameCount = frameCountOf(start, end);
    return {
      clip_id: clipId,
      event_id: event.event_id,
      camera_id: camera,
      resume_count: resume,
      event_sequence: resume === 0 ? 1 : (event.event_sequence ?? 1),
      rule_id: event.rule_id,
      severity: critical ? 'CRITICAL' : 'HIGH',
      anchor_capture_ms: anchor,
      clip_start_capture_ms: start,
      clip_end_capture_ms: end,
      frame_count: frameCount,
      starts_with_keyframe: true,
      truncated_start: truncatedStart,
      truncated_end: false,
      has_gaps: camera === GAPPED_CAMERA,
      content_type: 'video/h264',
      container: CONTAINER_ANNEXB,
      size_bytes: frameCount * BYTES_PER_FRAME,
      face_redaction: 'NONE',
      retention_hold: hold,
      auto_retained: critical && hold,
      delete_after_ms: deleteAfter,
      // 보관 기간이 지난 보존 없는 클립은 객체를 지우고 기록만 남긴다(명세 11.5).
      deleted_at_ms: !hold && t >= deleteAfter ? deleteAfter : null,
      uploaded_at_ms: uploaded,
      received_at_ms: uploaded,
    };
  }

  function clipsOf(event: RiskEventPayload, t: number) {
    if (event.source !== 'LIVE' || (event.severity !== 'CRITICAL' && event.severity !== 'HIGH')) {
      return [];
    }
    return anchorsOf(event).flatMap((_, resume) =>
      CAMERAS.flatMap((camera) => clipOf(event, resume, camera, t) ?? []),
    );
  }

  function current(clipId: string) {
    const at = index.get(clipId);
    const event = at && findEvent(at.eventId);
    const clip = at && event ? clipOf(event, at.resume, at.camera, now()) : undefined;
    return event && clip ? { event, clip } : undefined;
  }

  // 명세 12.6: 클립은 관리자만 본다. 만료된 실서버 토큰(혼합 모드)은 서버처럼 거절한다.
  function denied(request: Request) {
    const user = readLiveUser(request, now());
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') return problem(403, 'FORBIDDEN', '권한이 없습니다');
    return undefined;
  }

  const handlers = [
    http.get('*/api/events/:id/clips', ({ params, request }) => {
      const refused = denied(request);
      if (refused) return refused;
      const event = findEvent(String(params.id));
      if (!event) return problem(404, 'EVENT_NOT_FOUND', '이벤트가 없습니다');
      return HttpResponse.json({
        event_id: event.event_id,
        clips: clipsOf(event, now()),
      });
    }),
    http.get('*/api/clips/:id', async ({ params, request }) => {
      const refused = denied(request);
      if (refused) return refused;
      const found = current(String(params.id));
      if (!found) return problem(404, 'CLIP_NOT_FOUND', '클립이 없습니다');
      if (found.clip.deleted_at_ms !== null) {
        return problem(410, CLIP_ERROR.DELETED, '보관 기간이 지나 삭제된 클립입니다');
      }
      const frames = found.clip.frame_count;
      const url = await Promise.resolve(video(frames)).catch(() => undefined);
      if (!url) return problem(500, 'MOCK_VIDEO_FAILED', '시험 영상을 만들지 못했습니다');
      return HttpResponse.json({
        clip_id: found.clip.clip_id,
        url,
        expires_at_ms: now() + URL_TTL_MS,
        content_type: found.clip.content_type,
        container: found.clip.container,
      });
    }),
    http.put('*/api/clips/:id/retention', async ({ params, request }) => {
      const refused = denied(request);
      if (refused) return refused;
      const body = (await request.json().catch(() => undefined)) as
        { retention_hold?: unknown } | undefined;
      if (typeof body?.retention_hold !== 'boolean') {
        return problem(400, 'BAD_REQUEST', 'retention_hold 가 필요합니다');
      }
      const clipId = String(params.id);
      const found = current(clipId);
      if (!found) return problem(404, 'CLIP_NOT_FOUND', '클립이 없습니다');
      if (found.clip.retention_hold === body.retention_hold) return HttpResponse.json(found.clip);
      if (!body.retention_hold && found.clip.auto_retained) {
        return problem(409, CLIP_ERROR.AUTO_RETAINED, 'CRITICAL 이벤트 클립은 자동 보존입니다');
      }
      if (body.retention_hold && found.clip.deleted_at_ms !== null) {
        return problem(410, CLIP_ERROR.DELETED, '보관 기간이 지나 삭제된 클립입니다');
      }
      held.set(clipId, body.retention_hold);
      return HttpResponse.json(current(clipId)?.clip);
    }),
  ];

  return { handlers };
}

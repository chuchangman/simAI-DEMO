import { DEFAULT_SUPPLEMENT_LIMITS, supplementVisible } from '@/features/setup/supplement';
import type {
  SetupSessionResponse,
  SupplementMedia,
  SupplementMediaResult,
  SupplementRebake,
  SupplementState,
} from '@/features/setup/types';
import { problem, readLiveUser, unauthorized } from '@/mocks/problem';
import { http, HttpResponse } from 'msw/http';

// 맵 보강 촬영 mock(S15P31A101-607). 서버(SetupSupplementService)처럼 세션마다 파일 목록과 다시 굽기 하나를 둔다.
// 올리기 주소는 같은 출처의 /mock-storage/… 이고 PUT 을 받으면 올라온 것으로 친다. 다시 굽기는 조회할 때 시간으로 진행한다:
// 1.5초 대기(QUEUED) → 10초 굽기(RUNNING·BAKING_TEXTURE) → 끝(SUCCEEDED). 결과 규칙: 올린 파일이 모두 사진이고 3장 미만이면
// FALLBACK(TOO_FEW_REGISTERED, 원래 맵 유지), 아니면 APPLIED(새 맵, 지금 맵으로 바꿈). 파일 이름에 wide·gopro 가 있으면 그 파일만
// WIDE_FOV_REJECTED 로 붙지 않는다.

const QUEUED_MS = 1_500;
const BAKING_MS = 10_000;

const EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

interface MockMedia extends SupplementMedia {
  objectPath: string;
  put: boolean;
}

interface MockRebake extends SupplementRebake {
  startedAt: number;
}

interface SessionSupplement {
  media: MockMedia[];
  rebake: MockRebake | null;
}

export interface SupplementMockDeps {
  now: () => number;
  sessions: Map<string, SetupSessionResponse>;
  updateSession: (id: string, patch: Partial<SetupSessionResponse>) => SetupSessionResponse;
}

export function createSupplementMock({ now, sessions, updateSession }: SupplementMockDeps) {
  const bySession = new Map<string, SessionSupplement>();
  const byPath = new Map<string, MockMedia>();
  let seq = 0;

  const stateOf = (id: string): SessionSupplement => {
    let found = bySession.get(id);
    if (!found) {
      found = { media: [], rebake: null };
      bySession.set(id, found);
    }
    return found;
  };

  const strip = (media: MockMedia): SupplementMedia => {
    const out: Partial<MockMedia> = { ...media };
    delete out.objectPath;
    delete out.put;
    return out as SupplementMedia;
  };

  /** 시간이 지난 만큼 다시 굽기를 진행한다. 끝나면 결과를 세션에 반영한다. */
  const advance = (id: string) => {
    const sup = stateOf(id);
    const rebake = sup.rebake;
    if (!rebake || (rebake.status !== 'QUEUED' && rebake.status !== 'RUNNING')) return;
    const elapsed = now() - rebake.startedAt;
    if (elapsed < QUEUED_MS) return;
    if (elapsed < QUEUED_MS + BAKING_MS) {
      rebake.status = 'RUNNING';
      rebake.stage = 'BAKING_TEXTURE';
      rebake.progress_pct = Math.round(((elapsed - QUEUED_MS) / BAKING_MS) * 100);
      return;
    }
    const used = sup.media.filter((m) => rebake.media_ids.includes(m.media_id));
    const fallback = used.every((m) => m.kind === 'IMAGE') && used.length < 3;
    const results: SupplementMediaResult[] = used.map((m) => {
      const wide = /wide|gopro/i.test(m.file_name ?? '');
      const frames = m.kind === 'VIDEO' ? 32 : 1;
      if (fallback) {
        return {
          media_id: m.media_id,
          status: 'NOT_REGISTERED',
          frames_selected: frames,
          frames_registered: 0,
        };
      }
      return {
        media_id: m.media_id,
        status: wide ? 'WIDE_FOV_REJECTED' : 'USED',
        frames_selected: frames,
        frames_registered: wide ? 0 : frames - (m.kind === 'VIDEO' ? 2 : 0),
      };
    });
    const selected = results.reduce((s, r) => s + r.frames_selected, 0);
    const registered = results.reduce((s, r) => s + r.frames_registered, 0);
    const outcome = fallback ? 'FALLBACK' : 'APPLIED';
    const newScene = fallback ? rebake.base_scene_version : `scene-supplement-${rebake.rebake_id}`;
    Object.assign(rebake, {
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      progress_pct: 100,
      outcome,
      reason: fallback ? 'TOO_FEW_REGISTERED' : null,
      scene_version: newScene,
      scene_activated: fallback ? null : true,
      completed_at_ms: rebake.startedAt + QUEUED_MS + BAKING_MS,
      result: {
        status: outcome,
        reason: fallback ? 'TOO_FEW_REGISTERED' : null,
        input_role: 'SETUP_SUPPLEMENT_CAPTURE',
        media_count: used.length,
        frames_selected: selected,
        frames_registered: registered,
        alignment: {
          baseline_center_residual_m: 0.041,
          supplement_center_residual_m: fallback ? null : 0.046,
          baseline_fixed_reprojection_px: 1.8,
          supplement_fixed_reprojection_px: fallback ? null : 1.9,
        },
        media: results,
      },
    } satisfies Partial<SupplementRebake>);
    if (!fallback) updateSession(id, { scene_version: newScene });
  };

  const blockedReason = (session: SetupSessionResponse, sup: SessionSupplement): string | null => {
    if (!supplementVisible(session)) return 'SESSION_NOT_READY';
    // 세팅 완료(C17, -615) 뒤에는 보강 촬영·다시 굽기를 하지 않는다(서버와 같음)
    if (session.setup_completed_at_ms != null) return 'SETUP_COMPLETED';
    if (session.status !== 'COMPLETED') return 'SETUP_JOB_RUNNING';
    if (sup.rebake && (sup.rebake.status === 'QUEUED' || sup.rebake.status === 'RUNNING')) {
      return 'REBAKE_RUNNING';
    }
    if (!sup.media.some((m) => m.status === 'UPLOADED')) return 'NO_MEDIA';
    return null;
  };

  /** 세션 조회에 싣는 supplement. 다시 굽기를 먼저 진행한다. */
  const view = (session: SetupSessionResponse): SupplementState => {
    advance(session.setup_session_id);
    const sup = stateOf(session.setup_session_id);
    const reason = blockedReason(session, sup);
    let rebake: SupplementRebake | null = null;
    if (sup.rebake) {
      const copy: Partial<MockRebake> = { ...sup.rebake };
      delete copy.startedAt;
      rebake = copy as SupplementRebake;
    }
    return {
      media: sup.media.map(strip),
      limits: DEFAULT_SUPPLEMENT_LIMITS,
      can_upload: supplementVisible(session) && session.setup_completed_at_ms == null,
      can_rebake: reason === null,
      rebake_blocked_reason: reason,
      rebake,
    };
  };

  /** 다시 굽기 결과가 세션 맵 버전을 바꿀 수 있어 진행한 뒤의 세션을 다시 읽는다. */
  const withView = (session: SetupSessionResponse): SetupSessionResponse => {
    const supplement = view(session);
    return { ...(sessions.get(session.setup_session_id) ?? session), supplement };
  };

  const findSession = (id: string) => sessions.get(id);

  const handlers = [
    http.post('*/api/setup-sessions/:id/supplement-media', async ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const session = findSession(id);
      if (!session) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      if (!supplementVisible(session)) {
        return problem(
          409,
          'SUPPLEMENT_SESSION_NOT_READY',
          '미리보기 맵이 준비된 뒤에 올릴 수 있습니다',
        );
      }
      if (session.setup_completed_at_ms != null) {
        return problem(
          409,
          'SUPPLEMENT_SETUP_COMPLETED',
          '세팅을 완료한 뒤에는 맵을 보강할 수 없습니다',
        );
      }
      const raw: unknown = await request.json().catch(() => null);
      const body = typeof raw === 'object' && raw !== null ? raw : {};
      const contentType = Reflect.get(body, 'content_type');
      const size = Reflect.get(body, 'size_bytes');
      const fileName = Reflect.get(body, 'file_name');
      const source = Reflect.get(body, 'source');
      const sha256 = Reflect.get(body, 'sha256');
      if (
        typeof contentType !== 'string' ||
        !EXT[contentType] ||
        typeof size !== 'number' ||
        size < 1
      ) {
        return problem(400, 'INVALID_SUPPLEMENT_MEDIA', '올릴 수 없는 파일입니다');
      }
      const kind = contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE';
      const limits = DEFAULT_SUPPLEMENT_LIMITS;
      const sup = stateOf(id);
      const total = sup.media.reduce((s, m) => s + m.size_bytes, 0);
      if (
        size > (kind === 'VIDEO' ? limits.max_video_bytes : limits.max_image_bytes) ||
        sup.media.length + 1 > limits.max_items ||
        total + size > limits.max_total_bytes
      ) {
        return problem(409, 'SUPPLEMENT_LIMIT_EXCEEDED', '보강 촬영 개수·용량 상한을 넘었습니다');
      }
      const mediaId = `sup-${(++seq).toString(16).padStart(12, '0')}`;
      const objectPath = `setup/${id}/supplement/${mediaId}${EXT[contentType]}`;
      const media: MockMedia = {
        media_id: mediaId,
        kind,
        source: source === 'PHONE_UPLOAD' || source === 'FILE_UPLOAD' ? source : null,
        content_type: contentType,
        file_name: typeof fileName === 'string' ? fileName : null,
        size_bytes: size,
        sha256: typeof sha256 === 'string' ? sha256 : null,
        captured_at_ms: null,
        device: null,
        status: 'PENDING_UPLOAD',
        created_at_ms: t,
        uploaded_at_ms: null,
        objectPath,
        put: false,
      };
      sup.media.push(media);
      byPath.set(objectPath, media);
      return HttpResponse.json(
        {
          ...strip(media),
          upload: {
            method: 'PUT',
            url: `/mock-storage/${objectPath}`,
            headers: { 'Content-Type': contentType },
            expires_at_ms: t + 5 * 60_000,
          },
        },
        { status: 201 },
      );
    }),

    http.put('*/mock-storage/*', ({ request }) => {
      const path = new URL(request.url).pathname.replace(/^.*?\/mock-storage\//, '');
      const media = byPath.get(path);
      if (!media) return new HttpResponse(null, { status: 403 });
      media.put = true;
      return new HttpResponse(null, { status: 200 });
    }),

    http.post(
      '*/api/setup-sessions/:id/supplement-media/:mediaId/complete',
      ({ request, params }) => {
        const t = now();
        if (!readLiveUser(request, t)) return unauthorized();
        const media = stateOf(String(params.id ?? '')).media.find(
          (m) => m.media_id === String(params.mediaId ?? ''),
        );
        if (!media) return problem(404, 'SUPPLEMENT_MEDIA_NOT_FOUND', '파일을 찾을 수 없습니다');
        if (!media.put) {
          return problem(409, 'SUPPLEMENT_UPLOAD_INCOMPLETE', '저장소에 파일이 없습니다');
        }
        media.status = 'UPLOADED';
        media.uploaded_at_ms = media.uploaded_at_ms ?? t;
        return HttpResponse.json(strip(media));
      },
    ),

    http.delete('*/api/setup-sessions/:id/supplement-media/:mediaId', ({ request, params }) => {
      if (!readLiveUser(request, now())) return unauthorized();
      const id = String(params.id ?? '');
      const mediaId = String(params.mediaId ?? '');
      advance(id);
      const sup = stateOf(id);
      const index = sup.media.findIndex((m) => m.media_id === mediaId);
      if (index < 0) return problem(404, 'SUPPLEMENT_MEDIA_NOT_FOUND', '파일을 찾을 수 없습니다');
      const running = sup.rebake?.status === 'QUEUED' || sup.rebake?.status === 'RUNNING';
      if (running && sup.rebake?.media_ids.includes(mediaId)) {
        return problem(409, 'SUPPLEMENT_MEDIA_IN_USE', '다시 굽는 중에는 그 파일을 뺄 수 없습니다');
      }
      const [removed] = sup.media.splice(index, 1);
      if (removed) byPath.delete(removed.objectPath);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post('*/api/setup-sessions/:id/supplement-rebake', ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const session = findSession(id);
      if (!session) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      advance(id);
      const sup = stateOf(id);
      const reason = blockedReason(session, sup);
      const code: Record<string, string> = {
        SESSION_NOT_READY: 'SUPPLEMENT_SESSION_NOT_READY',
        SETUP_JOB_RUNNING: 'SUPPLEMENT_SETUP_JOB_RUNNING',
        SETUP_COMPLETED: 'SUPPLEMENT_SETUP_COMPLETED',
        REBAKE_RUNNING: 'SUPPLEMENT_REBAKE_IN_PROGRESS',
        NO_MEDIA: 'SUPPLEMENT_NO_MEDIA',
      };
      if (reason) return problem(409, code[reason] ?? 'SUPPLEMENT_SESSION_NOT_READY', reason);
      const base = session.scene_version ?? session.preview_scene_version ?? 'scene-preview-1';
      sup.rebake = {
        rebake_id: `rebake-${++seq}`,
        job_id: `job-rebake-${seq}`,
        status: 'QUEUED',
        stage: null,
        progress_pct: 0,
        media_ids: sup.media.filter((m) => m.status === 'UPLOADED').map((m) => m.media_id),
        base_scene_version: base,
        scene_version: null,
        outcome: null,
        reason: null,
        result: null,
        scene_activated: null,
        failure_code: null,
        failure_message: null,
        requested_at_ms: t,
        completed_at_ms: null,
        startedAt: t,
      };
      return HttpResponse.json(withView(session), { status: 202 });
    }),

    http.post('*/api/setup-sessions/:id/supplement-rebake/cancel', ({ request, params }) => {
      const t = now();
      if (!readLiveUser(request, t)) return unauthorized();
      const id = String(params.id ?? '');
      const session = findSession(id);
      if (!session) return problem(404, 'SETUP_SESSION_NOT_FOUND', '세팅 세션을 찾을 수 없습니다');
      advance(id);
      const rebake = stateOf(id).rebake;
      if (!rebake || (rebake.status !== 'QUEUED' && rebake.status !== 'RUNNING')) {
        return problem(409, 'SUPPLEMENT_REBAKE_NOT_RUNNING', '진행 중인 다시 굽기가 없습니다');
      }
      Object.assign(rebake, {
        status: 'CANCELLED',
        failure_code: 'CANCELLED',
        failure_message: '관리자가 다시 굽기를 취소했습니다',
        completed_at_ms: t,
      });
      return HttpResponse.json(withView(session));
    }),
  ];

  return { handlers, withView, bySession };
}

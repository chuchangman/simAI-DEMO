import type {
  SetupSessionResponse,
  SupplementLimits,
  SupplementMedia,
  SupplementMediaKind,
  SupplementRebake,
} from '@/features/setup/types';
import { ApiError } from '@/lib/http';

// 맵 보강 촬영(S15P31A101-607) 화면 계산. 미리보기 맵이 생긴 뒤 고정 카메라가 못 본 곳을 휴대폰·PC 파일로 찍어 올리고
// 다시 굽는다. 동영상·사진은 같은 입력이고 섞어도 된다. 찍은 기기는 등록 카메라가 아니다.

/** 서버가 상한을 알려 주기 전(옛 서버) 화면이 쓰는 값. 서버 SupplementLimits 와 같다. */
export const DEFAULT_SUPPLEMENT_LIMITS: SupplementLimits = {
  max_items: 32,
  max_video_bytes: 1024 * 1024 * 1024,
  max_image_bytes: 50 * 1024 * 1024,
  max_total_bytes: 4 * 1024 * 1024 * 1024,
  content_types: ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'],
};

/** 받는 형식과 종류. 브라우저가 형식을 비워 주면 확장자로 고른다. */
const CONTENT_KIND: Record<string, SupplementMediaKind> = {
  'video/mp4': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
};

const EXTENSION_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** 이 크기까지만 브라우저에서 SHA-256 을 잰다(파일 전체를 메모리에 올리므로 큰 동영상은 재지 않는다). */
export const HASH_MAX_BYTES = 64 * 1024 * 1024;

/** 다시 굽기·업로드 화면이 보일 세션 단계(미리보기 맵이 있어야 한다). */
const READY_STAGES = new Set(['READY_FOR_ZONES', 'BAKING_TEXTURE', 'COMPLETED']);

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** 파일의 올릴 형식. 받지 않는 형식이면 null. */
export function contentTypeOf(file: FileLike): string | null {
  const type = file.type.trim().toLowerCase();
  if (type && CONTENT_KIND[type]) return type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!type || type === 'application/octet-stream') return EXTENSION_TYPE[ext] ?? null;
  return null;
}

export function kindOfContentType(contentType: string): SupplementMediaKind | null {
  return CONTENT_KIND[contentType] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')} GB`;
  }
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 올릴 수 있는 크기 한도 한 줄: 파일 하나(동영상·사진)와 합계. */
export function supplementLimitText(limits: SupplementLimits): string {
  return `동영상 ${formatBytes(limits.max_video_bytes)} · 사진 ${formatBytes(limits.max_image_bytes)} · 합계 ${formatBytes(limits.max_total_bytes)}까지`;
}

export type FileCheck =
  { ok: true; contentType: string; kind: SupplementMediaKind } | { ok: false; reason: string };

export interface UploadBudget {
  /** 이미 서버 목록에 있거나 올리는 중인 파일 수 */
  count: number;
  /** 그 파일들의 크기 합 */
  totalBytes: number;
}

/** 파일 하나를 상한(형식·종류별 크기·개수·합계)에 비춰 본다. 통과하면 budget 에 더한 값을 쓰도록 호출한 쪽이 센다. */
export function checkSupplementFile(
  file: FileLike,
  limits: SupplementLimits,
  budget: UploadBudget,
): FileCheck {
  const contentType = contentTypeOf(file);
  const kind = contentType ? kindOfContentType(contentType) : null;
  if (!contentType || !kind || !limits.content_types.includes(contentType)) {
    return { ok: false, reason: '동영상(mp4·mov)이나 사진(jpg·png)만 올릴 수 있습니다' };
  }
  if (file.size < 1) return { ok: false, reason: '빈 파일입니다' };
  const max = kind === 'VIDEO' ? limits.max_video_bytes : limits.max_image_bytes;
  if (file.size > max) {
    return {
      ok: false,
      reason: `${kind === 'VIDEO' ? '동영상' : '사진'}은 ${formatBytes(max)}까지 올릴 수 있습니다`,
    };
  }
  if (budget.count + 1 > limits.max_items) {
    return { ok: false, reason: `파일은 ${limits.max_items}개까지 올릴 수 있습니다` };
  }
  if (budget.totalBytes + file.size > limits.max_total_bytes) {
    return { ok: false, reason: `합계 ${formatBytes(limits.max_total_bytes)}를 넘습니다` };
  }
  return { ok: true, contentType, kind };
}

/** 세션이 보강 촬영 카드를 보일 단계인지(미리보기 맵이 있다). */
export function supplementVisible(session: SetupSessionResponse | null | undefined): boolean {
  if (!session || !session.preview_scene_version) return false;
  return READY_STAGES.has(session.status);
}

/** 휴대폰으로 여는 보강 촬영 화면 주소(QR 로 보여 준다). */
export function phoneSupplementUrl(origin: string, setupSessionId: string): string {
  return `${origin.replace(/\/+$/, '')}/m/supplement/${encodeURIComponent(setupSessionId)}`;
}

/** 다시 굽기를 못 하는 이유(서버 rebake_blocked_reason). */
export const REBAKE_BLOCKED_LABEL: Record<string, string> = {
  SESSION_NOT_READY: '미리보기 맵이 준비되면 다시 구울 수 있습니다',
  SETUP_JOB_RUNNING: '정식 맵 굽기가 끝나면 다시 구울 수 있습니다',
  SUPERSEDED: '더 새로운 세팅이 있어 이 세팅의 맵은 다시 굽지 않습니다',
  REBAKE_RUNNING: '다시 굽는 중입니다',
  LIVE_WORK: '진행 중인 작업이 있어 다시 굽지 않습니다. 작업을 종료한 뒤 다시 시도하세요',
  NO_MEDIA: '올린 파일이 있어야 다시 구울 수 있습니다',
  NO_WORKER: '맵을 구울 작업 서버가 없습니다',
  BASE_MISSING: '이 세팅의 굽기 자료가 없어 다시 굽지 못합니다',
  REUSED_SCENE:
    '이전 모델을 재사용한 세팅이라 이 세팅의 맵이 없습니다. 맵을 보강하려면 새 모델로 세팅하세요',
  SETUP_COMPLETED: '세팅을 완료해 더 다시 굽지 않습니다',
};

export function rebakeBlockedText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REBAKE_BLOCKED_LABEL[reason] ?? '지금은 다시 구울 수 없습니다';
}

/** 올리기를 못 할 때의 안내. 세션 단계 문제만 따로 말한다. */
export function uploadBlockedText(reason: string | null | undefined): string {
  if (reason === 'SESSION_NOT_READY') return '미리보기 맵이 준비되면 올릴 수 있습니다';
  if (reason === 'SUPERSEDED') return '더 새로운 세팅이 있어 이 세팅에는 올리지 않습니다';
  if (reason === 'REUSED_SCENE') return '이전 모델을 재사용한 세팅에는 보강 촬영을 올리지 않습니다';
  if (reason === 'SETUP_COMPLETED') return '세팅을 완료해 더 보강 촬영을 올리지 않습니다';
  return '지금은 보강 촬영을 올릴 수 없습니다';
}

/** 보조 촬영을 넣지 못한 사유(계약 site_setup supplement_summary.reason). */
export const SUPPLEMENT_REASON_LABEL: Record<string, string> = {
  NO_USABLE_FRAMES: '쓸 수 있는 장면이 없었습니다',
  MEDIA_UNREADABLE: '파일을 읽지 못했습니다',
  MEDIA_DOWNLOAD_FAILED: '파일을 받지 못했습니다',
  TOO_FEW_REGISTERED: '고정 카메라 화면과 맞춰진 장면이 너무 적습니다',
  ALIGNMENT_WORSE: '넣으면 카메라 위치 정렬이 나빠집니다',
  FIXED_REPROJECTION_WORSE: '넣으면 고정 카메라끼리의 맞춤이 나빠집니다',
  RECONSTRUCTION_FAILED: '3D 복원에 실패했습니다',
  BAKE_FAILED: '맵 굽기에 실패했습니다',
  PATH_UNSUPPORTED: '이 작업 서버는 보강 촬영 굽기를 지원하지 않습니다',
  SEGMENTER_MISSING: '사람 지우기 모델이 없어 넣지 않았습니다',
  TIME_BUDGET: '처리 시간이 모자랐습니다',
  LIVE_WORK_STARTED: '작업이 시작돼 다시 굽기를 멈췄습니다(원래 맵 유지)',
};

export function supplementReasonText(reason: string | null | undefined): string {
  if (!reason) return '사유를 알 수 없습니다';
  return SUPPLEMENT_REASON_LABEL[reason] ?? `사유 ${reason}`;
}

/** 파일별 결과(계약 supplement_summary.media[].status). USED 만 맵에 붙었다. */
export const MEDIA_RESULT_LABEL: Record<string, string> = {
  USED: '반영됨',
  DOWNLOAD_FAILED: '붙지 않음 · 파일을 받지 못함',
  UNREADABLE: '붙지 않음 · 파일을 읽지 못함',
  NO_FRAMES: '붙지 않음 · 쓸 장면 없음',
  NOT_REGISTERED: '붙지 않음 · 고정 카메라 화면과 맞추지 못함',
  WIDE_FOV_REJECTED: '붙지 않음 · 초광각·어안 렌즈',
  // 맞춰진 장면은 있었지만 묶음이 품질 기준에 걸렸거나 굽기가 실패해 넣지 않았다. 이유는 위 사유 문구(계약 1.13.0, S15P31A101-652)
  REGISTERED_NOT_USED: '붙지 않음 · 화면과 맞췄지만 품질 기준에 걸려 넣지 않음',
};

export function mediaResultText(status: string): string {
  return MEDIA_RESULT_LABEL[status] ?? `붙지 않음 · ${status}`;
}

export type RebakeTone = 'ok' | 'active' | 'idle';

export interface RebakeMediaLine {
  mediaId: string;
  name: string;
  used: boolean;
  text: string;
}

export interface RebakeView {
  running: boolean;
  tone: RebakeTone;
  title: string;
  detail: string | null;
  progressPct: number | null;
  media: RebakeMediaLine[];
}

/** 다시 굽기가 끝나 새 맵이 반영됐는지(원래 맵 유지·실패·취소·진행 중이면 false). */
export function rebakeApplied(rebake: SupplementRebake): boolean {
  if (rebake.status !== 'SUCCEEDED') return false;
  return (rebake.outcome ?? rebake.result?.status ?? null) === 'APPLIED';
}

/** 서버에 올라와 있는데 맵에 아직 안 들어간 파일. 마지막으로 반영된 다시 굽기가 넣은 파일은 뺀다. */
export function unbakedMedia(
  media: readonly SupplementMedia[],
  rebake: SupplementRebake | null,
): SupplementMedia[] {
  const baked = new Set(rebake && rebakeApplied(rebake) ? rebake.media_ids : []);
  return media.filter((m) => m.status === 'UPLOADED' && !baked.has(m.media_id));
}

/** 다시 굽기 상태를 화면 문구로 바꾼다. 결과는 반영됨 / 원래 맵 유지 + 사유로만 말한다. */
export function describeRebake(
  rebake: SupplementRebake,
  media: readonly SupplementMedia[] = [],
): RebakeView {
  const names = new Map(media.map((m) => [m.media_id, m.file_name ?? m.media_id]));
  const lines: RebakeMediaLine[] = (rebake.result?.media ?? []).map((m) => ({
    mediaId: m.media_id,
    name: names.get(m.media_id) ?? m.media_id,
    used: m.status === 'USED',
    text: mediaResultText(m.status),
  }));
  if (rebake.status === 'QUEUED') {
    return {
      running: true,
      tone: 'active',
      title: '다시 굽기 대기 중',
      detail: null,
      progressPct: 0,
      media: [],
    };
  }
  if (rebake.status === 'RUNNING') {
    const pct = Math.round(rebake.progress_pct);
    return {
      running: true,
      tone: 'active',
      title: `다시 굽는 중 ${pct}%`,
      detail: rebake.stage === 'BAKING_TEXTURE' ? '맵 굽기' : null,
      progressPct: pct,
      media: [],
    };
  }
  if (rebake.status === 'CANCELLED') {
    return {
      running: false,
      tone: 'idle',
      title: '원래 맵 유지',
      detail: '다시 굽기를 취소했습니다',
      progressPct: null,
      media: lines,
    };
  }
  if (rebake.status === 'FAILED') {
    return {
      running: false,
      tone: 'idle',
      title: '원래 맵 유지',
      detail: rebake.failure_message
        ? `다시 굽기가 실패했습니다 · ${rebake.failure_message}`
        : '다시 굽기가 실패했습니다',
      progressPct: null,
      media: lines,
    };
  }
  if (rebakeApplied(rebake)) {
    return {
      running: false,
      tone: 'ok',
      title: '반영됨',
      detail:
        rebake.scene_activated === false
          ? '새 맵을 만들었지만 지금 맵은 바꾸지 않았습니다'
          : rebake.scene_activated === true
            ? '보강 촬영을 넣은 새 맵으로 바꿨습니다'
            : '보강 촬영을 넣은 새 맵을 만들었습니다',
      progressPct: null,
      media: lines,
    };
  }
  return {
    running: false,
    tone: 'idle',
    title: '원래 맵 유지',
    detail: supplementReasonText(rebake.reason ?? rebake.result?.reason),
    progressPct: null,
    media: lines,
  };
}

/** 다시 굽기가 진행 중이면 세션 조회를 계속 돌린다(세션이 COMPLETED 여도). */
export function rebakeRunning(session: SetupSessionResponse | null | undefined): boolean {
  const status = session?.supplement?.rebake?.status;
  return status === 'QUEUED' || status === 'RUNNING';
}

/** 보강 촬영 REST 오류를 안내 문구로 바꾼다. 서버 문구는 4xx 일 때 알려진 코드가 아니면만 쓴다. */
export function supplementErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const known = error.code ? SUPPLEMENT_ERROR_TEXT[error.code] : undefined;
  if (known) return known;
  if (error.status >= 400 && error.status < 500 && error.serverMessage) return error.serverMessage;
  return fallback;
}

export const SUPPLEMENT_ERROR_TEXT: Record<string, string> = {
  SUPPLEMENT_SESSION_NOT_READY: '미리보기 맵이 준비된 뒤에 할 수 있습니다',
  SUPPLEMENT_REUSED_SCENE: '이전 모델을 재사용한 세팅은 맵을 보강할 수 없습니다',
  SUPPLEMENT_SETUP_COMPLETED: '세팅을 완료한 뒤에는 맵 보강 촬영·다시 굽기를 할 수 없습니다',
  SUPPLEMENT_SETUP_JOB_RUNNING: '정식 맵 굽기가 끝나면 다시 구울 수 있습니다',
  SUPPLEMENT_SESSION_SUPERSEDED: '더 새로운 세팅이 있어 이 세팅에는 할 수 없습니다',
  SUPPLEMENT_REBAKE_IN_PROGRESS: '이미 다시 굽는 중입니다',
  SUPPLEMENT_NO_MEDIA: '올린 파일이 있어야 다시 구울 수 있습니다',
  SUPPLEMENT_REBAKE_BASE_MISSING: '이 세팅의 굽기 자료가 없어 다시 굽지 못합니다',
  SUPPLEMENT_LIMIT_EXCEEDED: '파일 개수나 용량 상한을 넘었습니다',
  SUPPLEMENT_UPLOAD_INCOMPLETE: '파일이 끝까지 올라가지 않았습니다. 다시 올려 주세요',
  SUPPLEMENT_MEDIA_IN_USE: '다시 굽는 중에는 그 파일을 뺄 수 없습니다',
  SUPPLEMENT_REBAKE_NOT_RUNNING: '진행 중인 다시 굽기가 없습니다',
  SUPPLEMENT_MEDIA_NOT_FOUND: '파일을 찾을 수 없습니다',
  INVALID_SUPPLEMENT_MEDIA: '올릴 수 없는 파일입니다',
  SETUP_SESSION_NOT_FOUND: '세팅 세션을 찾을 수 없습니다',
  SETUP_BLOCKED_BY_LIVE_WORK:
    '진행 중인 작업이 있어 다시 굽지 않습니다. 작업을 종료한 뒤 다시 시도하세요',
  SETUP_WORKER_UNAVAILABLE: '맵을 구울 작업 서버가 없습니다',
};

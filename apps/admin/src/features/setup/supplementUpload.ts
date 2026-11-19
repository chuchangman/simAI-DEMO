import {
  checkSupplementFile,
  HASH_MAX_BYTES,
  supplementErrorMessage,
  type UploadBudget,
} from '@/features/setup/supplement';
import type {
  IssuedSupplementMedia,
  IssueSupplementMediaBody,
  SupplementLimits,
  SupplementMedia,
  SupplementMediaKind,
  SupplementSource,
} from '@/features/setup/types';

// 맵 보강 촬영 파일 올리기 줄(S15P31A101-607). 파일마다 서버에서 서명 PUT 주소를 받고(올릴 차례가 될 때 받아 서명이 만료되지
// 않게 한다), 저장소로 바로 올린 뒤 완료를 알린다. 실패하면 서버의 빈 자리를 지운다. 휴대폰 망을 생각해 한 번에 하나씩 올린다.
// React 없이 시험할 수 있게 상태와 동작을 여기 두고 화면은 useSupplementUploads 가 구독한다.

export type UploadItemStatus =
  'queued' | 'hashing' | 'uploading' | 'confirming' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  localId: string;
  fileName: string;
  sizeBytes: number;
  kind: SupplementMediaKind;
  status: UploadItemStatus;
  /** 0~100. 올리는 중에만 뜻이 있다. */
  progress: number;
  error: string | null;
  mediaId: string | null;
}

export class UploadHttpError extends Error {
  constructor(readonly status: number) {
    super(`저장소 업로드 실패 (${status === 0 ? '연결 실패' : `HTTP ${status}`})`);
    this.name = 'UploadHttpError';
  }
}

export interface UploadQueueDeps {
  issue: (body: IssueSupplementMediaBody) => Promise<IssuedSupplementMedia>;
  put: (
    upload: IssuedSupplementMedia['upload'],
    file: File,
    onProgress: (pct: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  complete: (mediaId: string) => Promise<SupplementMedia>;
  remove: (mediaId: string) => Promise<void>;
  hash: (file: File) => Promise<string | null>;
  /** 파일 하나가 끝날 때마다(성공·실패) 부른다. 세션 조회를 다시 받게 한다. */
  onSettled?: () => void;
}

export interface UploadQueueState {
  items: UploadItem[];
  /** 추가할 때 상한에 걸린 파일 안내 */
  rejected: { fileName: string; reason: string }[];
}

export interface UploadQueue {
  getState: () => UploadQueueState;
  subscribe: (listener: () => void) => () => void;
  /** 파일들을 줄에 더한다. budget 은 서버 목록의 파일 수·크기(이미 올린 것). */
  add: (files: readonly File[], limits: SupplementLimits, budget: UploadBudget) => void;
  retry: (localId: string) => void;
  cancel: (localId: string) => void;
  dismiss: (localId: string) => void;
  clearRejected: () => void;
  /** 서버 목록에 나타난 완료 파일을 줄에서 지운다(그 뒤로는 서버 줄로만 보인다). */
  forgetDone: (serverMediaIds: ReadonlySet<string>) => void;
  /** 올리기를 받는다(화면에 붙을 때). */
  start: () => void;
  /** 올리는 중인 파일을 멈추고 다음 파일을 시작하지 않는다(화면을 떠날 때). start 로 다시 받는다. */
  stop: () => void;
}

const ACTIVE: ReadonlySet<UploadItemStatus> = new Set(['hashing', 'uploading', 'confirming']);
const PENDING: ReadonlySet<UploadItemStatus> = new Set([
  'queued',
  'hashing',
  'uploading',
  'confirming',
]);

/** 올릴 형식이 서명에 묶이므로 파일이 가진 형식 대신 검사한 형식을 쓴다. */
interface Entry {
  item: UploadItem;
  file: File;
  contentType: string;
  abort: AbortController | null;
}

let localSeq = 0;

export function createSupplementUploadQueue(
  deps: UploadQueueDeps,
  source: SupplementSource,
): UploadQueue {
  const entries: Entry[] = [];
  let state: UploadQueueState = { items: [], rejected: [] };
  const listeners = new Set<() => void>();
  let disposed = false;
  let running = false;

  const emit = () => {
    state = { ...state, items: entries.map((e) => e.item) };
    listeners.forEach((l) => l());
  };
  const patch = (entry: Entry, next: Partial<UploadItem>) => {
    entry.item = { ...entry.item, ...next };
    emit();
  };

  const pump = async () => {
    if (running || disposed) return;
    const entry = entries.find((e) => e.item.status === 'queued');
    if (!entry) return;
    running = true;
    try {
      await runOne(entry);
    } finally {
      running = false;
      deps.onSettled?.();
      void pump();
    }
  };

  const runOne = async (entry: Entry) => {
    const abort = new AbortController();
    entry.abort = abort;
    let mediaId: string | null = null;
    try {
      patch(entry, { status: 'hashing', progress: 0, error: null });
      const sha256 = await deps.hash(entry.file).catch(() => null);
      if (abort.signal.aborted) throw abort.signal.reason;
      const body: IssueSupplementMediaBody = {
        content_type: entry.contentType,
        size_bytes: entry.file.size,
        source,
        file_name: entry.file.name.slice(0, 255),
      };
      if (sha256) body.sha256 = sha256;
      const issued = await deps.issue(body);
      mediaId = issued.media_id;
      patch(entry, { status: 'uploading', mediaId });
      if (abort.signal.aborted) throw abort.signal.reason;
      await deps.put(
        issued.upload,
        entry.file,
        (pct) => {
          if (entry.item.status === 'uploading') patch(entry, { progress: pct });
        },
        abort.signal,
      );
      patch(entry, { status: 'confirming', progress: 100 });
      await deps.complete(issued.media_id);
      patch(entry, { status: 'done' });
    } catch (error) {
      const cancelled = abort.signal.aborted;
      // 서버에 자리만 잡고 끝나지 않은 파일은 지워 상한을 비운다(실패해도 다시 지울 수 있게 목록에 남는다)
      if (mediaId) await deps.remove(mediaId).catch(() => undefined);
      patch(entry, {
        status: cancelled ? 'cancelled' : 'failed',
        mediaId: null,
        error: cancelled ? null : uploadErrorText(error),
      });
    } finally {
      entry.abort = null;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (files, limits, budget) => {
      const inFlight = entries.filter((e) => PENDING.has(e.item.status));
      let count = budget.count + inFlight.length;
      let total = budget.totalBytes + inFlight.reduce((s, e) => s + e.item.sizeBytes, 0);
      const rejected: UploadQueueState['rejected'] = [];
      for (const file of files) {
        const check = checkSupplementFile(file, limits, { count, totalBytes: total });
        if (!check.ok) {
          rejected.push({ fileName: file.name, reason: check.reason });
          continue;
        }
        count += 1;
        total += file.size;
        entries.push({
          file,
          contentType: check.contentType,
          abort: null,
          item: {
            localId: `up-${++localSeq}`,
            fileName: file.name,
            sizeBytes: file.size,
            kind: check.kind,
            status: 'queued',
            progress: 0,
            error: null,
            mediaId: null,
          },
        });
      }
      state = { ...state, rejected };
      emit();
      void pump();
    },
    retry: (localId) => {
      const entry = entries.find((e) => e.item.localId === localId);
      if (!entry || (entry.item.status !== 'failed' && entry.item.status !== 'cancelled')) return;
      patch(entry, { status: 'queued', progress: 0, error: null });
      void pump();
    },
    cancel: (localId) => {
      const entry = entries.find((e) => e.item.localId === localId);
      if (!entry) return;
      if (entry.item.status === 'queued') {
        patch(entry, { status: 'cancelled' });
      } else if (ACTIVE.has(entry.item.status)) {
        entry.abort?.abort(new DOMException('cancelled', 'AbortError'));
      }
    },
    dismiss: (localId) => {
      const index = entries.findIndex((e) => e.item.localId === localId);
      if (index < 0 || PENDING.has(entries[index]!.item.status)) return;
      entries.splice(index, 1);
      emit();
    },
    clearRejected: () => {
      state = { ...state, rejected: [] };
      emit();
    },
    forgetDone: (serverMediaIds) => {
      const before = entries.length;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const item = entries[i]!.item;
        if (item.status === 'done' && item.mediaId && serverMediaIds.has(item.mediaId)) {
          entries.splice(i, 1);
        }
      }
      if (entries.length !== before) emit();
    },
    start: () => {
      disposed = false;
      void pump();
    },
    stop: () => {
      disposed = true;
      entries.forEach((e) => e.abort?.abort(new DOMException('stopped', 'AbortError')));
    },
  };
}

function uploadErrorText(error: unknown): string {
  if (error instanceof UploadHttpError) {
    return error.status === 0
      ? '저장소에 연결하지 못했습니다. 망을 확인하고 다시 올려 주세요'
      : '저장소가 파일을 받지 않았습니다. 다시 올려 주세요';
  }
  return supplementErrorMessage(error, '올리지 못했습니다. 다시 올려 주세요');
}

/** 브라우저가 직접 넣는 헤더는 XHR 에 싣지 않는다(서명에는 들어 있어도 브라우저가 같은 값을 보낸다). */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection']);

/** 서명 PUT 주소로 파일을 올린다. 진행률을 알리려고 XMLHttpRequest 를 쓴다. */
export function putWithXhr(
  upload: IssuedSupplementMedia['upload'],
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) {
      if (!FORBIDDEN_HEADERS.has(name.toLowerCase())) xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadHttpError(xhr.status));
    };
    xhr.onerror = () => reject(new UploadHttpError(0));
    xhr.onabort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** 작은 파일만 SHA-256(16진수)을 잰다. 큰 동영상·보안 맥락 밖은 null(서버가 해시 없이 서명한다). */
export async function hashSmallFile(file: File): Promise<string | null> {
  if (file.size > HASH_MAX_BYTES) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SupplementRowAction = 'remove' | 'cancel' | 'retry' | 'dismiss';

export interface SupplementRow {
  key: string;
  name: string;
  sizeBytes: number;
  kind: SupplementMediaKind;
  statusText: string;
  /** 올리는 중일 때 0~100, 아니면 null */
  progress: number | null;
  failed: boolean;
  /** 서버 목록의 파일(빼기용) */
  mediaId: string | null;
  /** 이 화면이 올리는 파일(취소·다시·지우기용) */
  localId: string | null;
  actions: SupplementRowAction[];
}

const LOCAL_STATUS_TEXT: Record<UploadItemStatus, string> = {
  queued: '대기',
  hashing: '준비 중',
  uploading: '올리는 중',
  confirming: '확인 중',
  done: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

/**
 * 서버 목록(올린 파일)과 이 화면이 올리는 줄을 한 목록으로 합친다. 이 화면이 끝낸 파일은 서버 목록에 나타나면 서버 줄로 보이고,
 * 다른 기기(휴대폰·PC)에서 올리는 중인 파일은 서버 줄의 "올리는 중(다른 기기)"으로 보인다.
 */
export function mergeUploadRows(
  serverMedia: readonly SupplementMedia[],
  localItems: readonly UploadItem[],
  removeBlocked = false,
): SupplementRow[] {
  const localByMedia = new Map(
    localItems.filter((i) => i.mediaId).map((i) => [i.mediaId as string, i]),
  );
  const serverIds = new Set(serverMedia.map((m) => m.media_id));
  const rows: SupplementRow[] = serverMedia.map((m) => {
    const local = localByMedia.get(m.media_id);
    if (local && PENDING.has(local.status)) return localRow(local);
    const uploaded = m.status === 'UPLOADED';
    return {
      key: `media-${m.media_id}`,
      name: m.file_name ?? m.media_id,
      sizeBytes: m.size_bytes,
      kind: m.kind,
      statusText: uploaded ? '완료' : '올리는 중(다른 기기)',
      progress: null,
      failed: false,
      mediaId: m.media_id,
      localId: null,
      actions: removeBlocked ? [] : ['remove'],
    };
  });
  for (const item of localItems) {
    if (item.mediaId && serverIds.has(item.mediaId)) continue;
    // 끝났지만 서버 목록을 아직 다시 받지 않은 파일
    rows.push(localRow(item));
  }
  return rows;
}

function localRow(item: UploadItem): SupplementRow {
  const actions: SupplementRowAction[] = PENDING.has(item.status)
    ? ['cancel']
    : item.status === 'failed' || item.status === 'cancelled'
      ? ['retry', 'dismiss']
      : [];
  return {
    key: `local-${item.localId}`,
    name: item.fileName,
    sizeBytes: item.sizeBytes,
    kind: item.kind,
    statusText:
      item.status === 'uploading'
        ? `올리는 중 ${item.progress}%`
        : item.status === 'failed' && item.error
          ? `실패 · ${item.error}`
          : LOCAL_STATUS_TEXT[item.status],
    progress: item.status === 'uploading' ? item.progress : null,
    failed: item.status === 'failed',
    mediaId: null,
    localId: item.localId,
    actions,
  };
}

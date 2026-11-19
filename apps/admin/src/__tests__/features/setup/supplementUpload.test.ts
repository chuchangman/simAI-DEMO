import { DEFAULT_SUPPLEMENT_LIMITS } from '@/features/setup/supplement';
import {
  createSupplementUploadQueue,
  mergeUploadRows,
  UploadHttpError,
  type UploadItem,
  type UploadQueueDeps,
} from '@/features/setup/supplementUpload';
import type { IssuedSupplementMedia, SupplementMedia } from '@/features/setup/types';
import { describe, expect, it, vi } from 'vitest';

const flush = () => new Promise((r) => setTimeout(r, 0));

function media(id: string, patch: Partial<SupplementMedia> = {}): SupplementMedia {
  return {
    media_id: id,
    kind: 'VIDEO',
    source: 'FILE_UPLOAD',
    content_type: 'video/mp4',
    file_name: `${id}.mp4`,
    size_bytes: 10,
    sha256: null,
    captured_at_ms: null,
    device: null,
    status: 'UPLOADED',
    created_at_ms: 1,
    uploaded_at_ms: 2,
    ...patch,
  };
}

function fakeDeps(overrides: Partial<UploadQueueDeps> = {}) {
  let seq = 0;
  const issued: unknown[] = [];
  const deps: UploadQueueDeps = {
    issue: vi.fn((body) => {
      issued.push(body);
      const id = `sup-${++seq}`;
      return Promise.resolve({
        ...media(id, { status: 'PENDING_UPLOAD' }),
        upload: { method: 'PUT', url: `/s/${id}`, headers: {}, expires_at_ms: 9 },
      } satisfies IssuedSupplementMedia);
    }),
    put: vi.fn((_upload, _file, onProgress: (pct: number) => void) => {
      onProgress(50);
      return Promise.resolve();
    }),
    complete: vi.fn((id: string) => Promise.resolve(media(id))),
    remove: vi.fn(() => Promise.resolve()),
    hash: vi.fn(() => Promise.resolve('a'.repeat(64))),
    onSettled: vi.fn(),
    ...overrides,
  };
  return { deps, issued };
}

const video = (name = 'walk.mp4', size = 100) =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4' });

describe('보강 촬영 올리기 줄', () => {
  it('받기 → 저장소 PUT → 완료 알림 순서로 한 파일씩 올리고 해시·출처·이름을 싣는다', async () => {
    const { deps, issued } = fakeDeps();
    const queue = createSupplementUploadQueue(deps, 'PHONE_UPLOAD');
    queue.add([video('a.mp4'), video('b.mp4')], DEFAULT_SUPPLEMENT_LIMITS, {
      count: 0,
      totalBytes: 0,
    });
    await vi.waitFor(() =>
      expect(queue.getState().items.map((i) => i.status)).toEqual(['done', 'done']),
    );
    expect(issued).toEqual([
      {
        content_type: 'video/mp4',
        size_bytes: 100,
        source: 'PHONE_UPLOAD',
        file_name: 'a.mp4',
        sha256: 'a'.repeat(64),
      },
      expect.objectContaining({ file_name: 'b.mp4' }),
    ]);
    expect(deps.complete).toHaveBeenCalledWith('sup-1');
    expect(deps.onSettled).toHaveBeenCalledTimes(2);
    expect(queue.getState().items.map((i) => i.mediaId)).toEqual(['sup-1', 'sup-2']);
  });

  it('해시를 못 재면 해시 없이 받는다', async () => {
    const { deps, issued } = fakeDeps({ hash: () => Promise.resolve(null) });
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    queue.add([video()], DEFAULT_SUPPLEMENT_LIMITS, { count: 0, totalBytes: 0 });
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('done'));
    expect(issued[0]).not.toHaveProperty('sha256');
  });

  it('PUT 이 실패하면 서버 자리를 지우고 실패로 남긴 뒤 다시 올릴 수 있다', async () => {
    let fail = true;
    const { deps } = fakeDeps({
      put: vi.fn(() => (fail ? Promise.reject(new UploadHttpError(403)) : Promise.resolve())),
    });
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    queue.add([video()], DEFAULT_SUPPLEMENT_LIMITS, { count: 0, totalBytes: 0 });
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('failed'));
    expect(deps.remove).toHaveBeenCalledWith('sup-1');
    expect(queue.getState().items[0]).toMatchObject({
      mediaId: null,
      error: '저장소가 파일을 받지 않았습니다. 다시 올려 주세요',
    });
    fail = false;
    queue.retry(queue.getState().items[0]!.localId);
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('done'));
    expect(queue.getState().items[0]?.mediaId).toBe('sup-2');
  });

  it('올리는 중 취소하면 멈추고 서버 자리를 지운다. 대기 중 취소는 시작하지 않는다', async () => {
    const { deps } = fakeDeps({
      put: vi.fn(
        (_u, _f, _p, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
      ),
    });
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    queue.add([video('a.mp4'), video('b.mp4')], DEFAULT_SUPPLEMENT_LIMITS, {
      count: 0,
      totalBytes: 0,
    });
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('uploading'));
    const [first, second] = queue.getState().items as [UploadItem, UploadItem];
    queue.cancel(second.localId);
    queue.cancel(first.localId);
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('cancelled'));
    await flush();
    expect(queue.getState().items[1]?.status).toBe('cancelled');
    expect(deps.remove).toHaveBeenCalledWith('sup-1');
    expect(deps.issue).toHaveBeenCalledTimes(1);
    queue.dismiss(first.localId);
    expect(queue.getState().items).toHaveLength(1);
  });

  it('상한에 걸린 파일은 줄에 넣지 않고 사유를 남긴다(올리는 중인 파일도 센다)', () => {
    const { deps } = fakeDeps({ put: () => new Promise(() => undefined) });
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    const limits = { ...DEFAULT_SUPPLEMENT_LIMITS, max_items: 2 };
    queue.add(
      [
        video('a.mp4'),
        new File(['x'], 'b.gif', { type: 'image/gif' }),
        video('c.mp4'),
        video('d.mp4'),
      ],
      limits,
      { count: 1, totalBytes: 0 },
    );
    expect(queue.getState().items.map((i) => i.fileName)).toEqual(['a.mp4']);
    expect(queue.getState().rejected).toEqual([
      { fileName: 'b.gif', reason: '동영상(mp4·mov)이나 사진(jpg·png)만 올릴 수 있습니다' },
      { fileName: 'c.mp4', reason: '파일은 2개까지 올릴 수 있습니다' },
      { fileName: 'd.mp4', reason: '파일은 2개까지 올릴 수 있습니다' },
    ]);
    queue.clearRejected();
    expect(queue.getState().rejected).toEqual([]);
  });

  it('멈추면 올리던 파일을 끊고 다시 시작하면 남은 파일을 올린다', async () => {
    const { deps } = fakeDeps({
      put: vi.fn(
        (_u, _f, _p, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
          }),
      ),
    });
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    queue.add([video('a.mp4'), video('b.mp4')], DEFAULT_SUPPLEMENT_LIMITS, {
      count: 0,
      totalBytes: 0,
    });
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('uploading'));
    queue.stop();
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('cancelled'));
    await flush();
    expect(queue.getState().items[1]?.status).toBe('queued');
    queue.start();
    await vi.waitFor(() => expect(queue.getState().items[1]?.status).toBe('uploading'));
  });

  it('서버 목록에 나타난 완료 파일은 줄에서 지운다', async () => {
    const { deps } = fakeDeps();
    const queue = createSupplementUploadQueue(deps, 'FILE_UPLOAD');
    queue.add([video()], DEFAULT_SUPPLEMENT_LIMITS, { count: 0, totalBytes: 0 });
    await vi.waitFor(() => expect(queue.getState().items[0]?.status).toBe('done'));
    queue.forgetDone(new Set(['other']));
    expect(queue.getState().items).toHaveLength(1);
    queue.forgetDone(new Set(['sup-1']));
    expect(queue.getState().items).toHaveLength(0);
  });
});

describe('보강 촬영 목록 합치기', () => {
  const local = (patch: Partial<UploadItem>): UploadItem => ({
    localId: 'up-1',
    fileName: 'new.mp4',
    sizeBytes: 5,
    kind: 'VIDEO',
    status: 'uploading',
    progress: 30,
    error: null,
    mediaId: null,
    ...patch,
  });

  it('서버 파일은 완료·빼기, 다른 기기에서 올리는 중인 파일은 그렇게 보인다', () => {
    const rows = mergeUploadRows(
      [media('sup-1'), media('sup-2', { status: 'PENDING_UPLOAD', kind: 'IMAGE' })],
      [],
    );
    expect(rows.map((r) => [r.name, r.statusText, r.actions])).toEqual([
      ['sup-1.mp4', '완료', ['remove']],
      ['sup-2.mp4', '올리는 중(다른 기기)', ['remove']],
    ]);
    expect(mergeUploadRows([media('sup-1')], [], true)[0]?.actions).toEqual([]);
  });

  it('이 화면이 올리는 파일은 진행률과 취소, 실패는 사유와 다시·지우기', () => {
    const rows = mergeUploadRows(
      [media('sup-9', { status: 'PENDING_UPLOAD' })],
      [
        local({ mediaId: 'sup-9', progress: 30 }),
        local({ localId: 'up-2', status: 'failed', error: '망 끊김', fileName: 'x.jpg' }),
        local({ localId: 'up-3', status: 'done', mediaId: 'sup-10', fileName: 'y.mp4' }),
      ],
    );
    expect(rows.map((r) => [r.name, r.statusText, r.progress, r.actions])).toEqual([
      ['new.mp4', '올리는 중 30%', 30, ['cancel']],
      ['x.jpg', '실패 · 망 끊김', null, ['retry', 'dismiss']],
      ['y.mp4', '완료', null, []],
    ]);
  });
});

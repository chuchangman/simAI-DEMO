import {
  cancelSupplementRebake,
  completeSupplementMedia,
  issueSupplementMedia,
  removeSupplementMedia,
  setupSessionKey,
  startSupplementRebake,
} from '@/features/setup/api';
import {
  DEFAULT_SUPPLEMENT_LIMITS,
  describeRebake,
  supplementErrorMessage,
  unbakedMedia,
} from '@/features/setup/supplement';
import {
  createSupplementUploadQueue,
  hashSmallFile,
  mergeUploadRows,
  putWithXhr,
  type SupplementRow,
  type SupplementRowAction,
  type UploadQueue,
  type UploadQueueDeps,
  type UploadQueueState,
} from '@/features/setup/supplementUpload';
import type {
  SetupSessionResponse,
  SupplementLimits,
  SupplementMedia,
  SupplementSource,
} from '@/features/setup/types';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

// 맵 보강 촬영(S15P31A101-607) 서버 데이터 훅: 파일 올리기 줄, 다시 굽기·취소, 파일 빼기.

const EMPTY_MEDIA: readonly SupplementMedia[] = [];
const EMPTY_STATE: UploadQueueState = { items: [], rejected: [] };

/**
 * 세션 하나의 보강 촬영 올리기 줄. 세션이 바뀌면 새 줄을 만들고 지난 줄의 업로드는 멈춘다.
 * 파일 하나가 끝날 때마다 세션 조회를 다시 받아 서버 목록을 맞춘다. overrides 는 시험용이다.
 */
export function useSupplementUploads(
  sessionId: string | null,
  source: SupplementSource,
  serverMedia: readonly SupplementMedia[] = EMPTY_MEDIA,
  overrides: Partial<UploadQueueDeps> = {},
) {
  const queryClient = useQueryClient();
  // 시험이 넘기는 대역은 처음 값만 쓴다(렌더마다 새 객체여도 줄을 다시 만들지 않는다)
  const [initialOverrides] = useState(overrides);
  // 줄 만들기는 부작용이 없다(올리기는 add 뒤에 시작). 세션·출처가 바뀌면 새 줄을 쓴다
  const queue = useMemo<UploadQueue | null>(() => {
    if (!sessionId) return null;
    return createSupplementUploadQueue(
      {
        issue: (body) => issueSupplementMedia(api, sessionId, body),
        put: putWithXhr,
        complete: (mediaId) => completeSupplementMedia(api, sessionId, mediaId),
        remove: (mediaId) => removeSupplementMedia(api, sessionId, mediaId),
        hash: hashSmallFile,
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: setupSessionKey(sessionId) });
        },
        ...initialOverrides,
      },
      source,
    );
  }, [sessionId, source, queryClient, initialOverrides]);
  // 화면을 떠나거나 세션이 바뀌면 지난 줄의 업로드를 멈춘다
  useEffect(() => {
    queue?.start();
    return () => queue?.stop();
  }, [queue]);

  const subscribe = useCallback(
    (listener: () => void) => (queue ? queue.subscribe(listener) : () => undefined),
    [queue],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => queue?.getState() ?? EMPTY_STATE,
    () => EMPTY_STATE,
  );

  // 서버 목록에 나타난 완료 파일은 줄에서 지운다
  const serverIds = useMemo(() => new Set(serverMedia.map((m) => m.media_id)), [serverMedia]);
  useEffect(() => {
    queue?.forgetDone(serverIds);
  }, [queue, serverIds, state.items]);

  const add = useCallback(
    (files: readonly File[], limits: SupplementLimits) => {
      if (!queue) return;
      queue.add(files, limits, {
        count: serverMedia.length,
        totalBytes: serverMedia.reduce((sum, m) => sum + m.size_bytes, 0),
      });
    },
    [queue, serverMedia],
  );

  return {
    items: state.items,
    rejected: state.rejected,
    add,
    retry: (localId: string) => queue?.retry(localId),
    cancel: (localId: string) => queue?.cancel(localId),
    dismiss: (localId: string) => queue?.dismiss(localId),
    clearRejected: () => queue?.clearRejected(),
  };
}

/** 다시 굽기·취소·파일 빼기. 성공하면 서버가 준 세션으로 바로 그린다(빼기는 다시 받는다). */
export function useSupplementActions(sessionId: string | null) {
  const queryClient = useQueryClient();
  const putSession = (session: SetupSessionResponse) =>
    queryClient.setQueryData(setupSessionKey(session.setup_session_id), session);

  const rebake = useMutation({
    mutationFn: (id: string) => startSupplementRebake(api, id),
    onSuccess: putSession,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSupplementRebake(api, id),
    onSuccess: putSession,
  });
  const remove = useMutation({
    mutationFn: ({ id, mediaId }: { id: string; mediaId: string }) =>
      removeSupplementMedia(api, id, mediaId),
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: setupSessionKey(vars.id) });
    },
  });

  const error = rebake.error ?? cancel.error ?? remove.error;
  const fallback = rebake.error
    ? '다시 굽기를 시작하지 못했습니다'
    : cancel.error
      ? '다시 굽기를 취소하지 못했습니다'
      : '파일을 빼지 못했습니다';

  return {
    startRebake: () => {
      if (sessionId && !rebake.isPending) rebake.mutate(sessionId);
    },
    rebakePending: rebake.isPending,
    cancelRebake: () => {
      if (sessionId && !cancel.isPending) cancel.mutate(sessionId);
    },
    cancelPending: cancel.isPending,
    removeMedia: (mediaId: string) => {
      if (sessionId) remove.mutate({ id: sessionId, mediaId });
    },
    removingMediaId: remove.isPending ? (remove.variables?.mediaId ?? null) : null,
    error: error ? supplementErrorMessage(error, fallback) : null,
  };
}

/**
 * 세팅 카드·휴대폰 화면이 같이 쓰는 묶음: 서버 상태(세션 supplement)와 올리기 줄을 합친 목록, 다시 굽기 동작, 줄 동작 처리.
 * 옛 서버(supplement 없음)면 상한은 기본값이고 올리기·다시 굽기는 막힌다.
 */
export function useSupplementCapture(
  session: SetupSessionResponse | null,
  source: SupplementSource,
  overrides: Partial<UploadQueueDeps> = {},
) {
  const sessionId = session?.setup_session_id ?? null;
  const supplement = session?.supplement ?? null;
  const serverMedia = supplement?.media ?? EMPTY_MEDIA;
  const limits = supplement?.limits ?? DEFAULT_SUPPLEMENT_LIMITS;
  const uploads = useSupplementUploads(sessionId, source, serverMedia, overrides);
  const actions = useSupplementActions(sessionId);
  const rebake = supplement?.rebake ?? null;
  const rebaking = rebake?.status === 'QUEUED' || rebake?.status === 'RUNNING';
  // 다시 굽는 중에는 그 굽기에 들어간 파일을 빼지 못한다(서버 409). 화면은 빼기를 숨긴다
  const rows = useMemo(
    () => mergeUploadRows(serverMedia, uploads.items, rebaking),
    [serverMedia, uploads.items, rebaking],
  );
  // 맵에 아직 안 들어간 파일이 있고 서버가 굽게 해 줄 때만 다시 구울 수 있다(서버 can_rebake 는 파일이 하나라도 있으면 켜진다)
  const pendingMedia = useMemo(() => unbakedMedia(serverMedia, rebake), [serverMedia, rebake]);
  const canRebakeNow = (supplement?.can_rebake ?? false) && pendingMedia.length > 0;

  const onRowAction = useCallback(
    (row: SupplementRow, action: SupplementRowAction) => {
      if (action === 'remove' && row.mediaId) actions.removeMedia(row.mediaId);
      else if (action === 'cancel' && row.localId) uploads.cancel(row.localId);
      else if (action === 'retry' && row.localId) uploads.retry(row.localId);
      else if (action === 'dismiss' && row.localId) uploads.dismiss(row.localId);
    },
    [actions, uploads],
  );

  return {
    supplement,
    limits,
    rows,
    rejected: uploads.rejected,
    canUpload: supplement?.can_upload ?? false,
    addFiles: (files: readonly File[]) => uploads.add(files, limits),
    onRowAction,
    rebake,
    rebakeView: rebake ? describeRebake(rebake, serverMedia) : null,
    pendingMedia,
    canRebakeNow,
    ...actions,
  };
}

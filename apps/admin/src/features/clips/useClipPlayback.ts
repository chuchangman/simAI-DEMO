import { requestClipUrl } from '@/features/clips/api';
import { ClipMediaError, loadPlayableClip } from '@/features/clips/clipMedia';
import { CLIP_ERROR } from '@/features/clips/constants';
import type { Clip } from '@/features/clips/types';
import { clipsKey } from '@/features/clips/useEventClips';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

/** 주소가 이 시간 안에 만료되면 새로 받는다(ms). EC2 시계와 이 브라우저 시계의 차이를 넉넉히 본다. */
const EXPIRY_MARGIN_MS = 5_000;

/**
 * 주소를 받은 지 이 시간(ms)이 지난 뒤의 재생 실패는 주소 만료(되감기·이어 받기 중)로 보고 다시 받는다.
 * 그보다 빠른 실패는 한 번만 다시 받는다. 영상이 계속 깨져도 주소를 이 간격보다 자주 받지 않는다.
 */
const STALE_AFTER_MS = 30_000;

const MEDIA_ERROR: Record<ClipMediaError['reason'], string> = {
  UNSUPPORTED: '지원하지 않는 영상 형식입니다',
  DOWNLOAD: '영상을 받지 못했습니다',
  FORMAT: '영상 형식을 읽지 못했습니다',
};

const PLAY_URL_FAILED = '재생 주소를 받지 못했습니다';
const PLAY_FAILED = '재생하지 못했습니다';

/** 보관 기간이 지나 지운 클립(410 CLIP_DELETED). 목록을 받은 뒤에 지워진 클립을 눌렀을 때 온다. */
const isDeletedError = (error: unknown) =>
  error instanceof ApiError && error.status === 410 && error.code === CLIP_ERROR.DELETED;

/** 재생 주소를 받지 못한 이유를 알아볼 수 있게 알린다. */
function describeFailure(error: unknown) {
  if (isDeletedError(error)) return '삭제된 클립입니다';
  if (error instanceof ClipMediaError) return MEDIA_ERROR[error.reason];
  return PLAY_URL_FAILED;
}

/**
 * 클립 재생 주소. 재생을 누를 때만 받는다. EC2 가 주소를 줄 때 조회 기록을 남기므로(명세 14장)
 * 상세를 열기만 해서는 받지 않는다. 받은 주소가 만료됐으면 새로 받고, 재생이 실패하면 위 규칙대로 다시 받는다.
 * `h264-annexb` 클립은 받아서 MP4 로 감싼 뒤 재생하므로 주소를 받은 뒤 영상까지 받는 동안 pending 이다.
 */
export function useClipPlayback(eventId: string, clip: Clip) {
  const queryClient = useQueryClient();
  const aborter = useRef<AbortController>(undefined);
  const mutation = useMutation({
    mutationFn: async () => {
      aborter.current?.abort();
      const controller = new AbortController();
      aborter.current = controller;
      const info = await requestClipUrl(api, clip.clip_id);
      return loadPlayableClip(info, clip, controller.signal);
    },
    // 그새 지워진 클립이면 목록도 다시 받아 삭제됨으로 그린다.
    onError: (error) => {
      if (isDeletedError(error)) {
        void queryClient.invalidateQueries({ queryKey: clipsKey(eventId) });
      }
    },
  });
  const retried = useRef(false);
  const [playFailed, setPlayFailed] = useState(false);
  // 재생을 누를 때마다 는다. 영상을 새로 띄워 처음부터 다시 재생한다(주소가 살아 있으면 주소는 그대로 쓴다).
  const [round, setRound] = useState(0);

  const data = mutation.data;
  // 감싼 영상의 blob 주소는 새 영상으로 바뀌거나 화면이 닫힐 때 해제한다.
  useEffect(() => () => data?.release(), [data]);
  useEffect(() => () => aborter.current?.abort(), []);

  const play = () => {
    retried.current = false;
    setPlayFailed(false);
    setRound((n) => n + 1);
    if (!data || data.expiresAtMs - EXPIRY_MARGIN_MS <= Date.now()) mutation.mutate();
  };

  /** 재생이 실패했을 때(주소 만료 등) 부른다. */
  const onError = () => {
    if (retried.current && Date.now() - mutation.submittedAt < STALE_AFTER_MS) {
      setPlayFailed(true);
      return;
    }
    retried.current = true;
    mutation.mutate();
  };

  const url = mutation.isError || playFailed ? undefined : data?.url;
  let error: string | undefined;
  if (mutation.isError) error = describeFailure(mutation.error);
  else if (playFailed) error = PLAY_FAILED;
  return {
    url,
    /** 영상 요소의 key. 주소가 바뀌거나 재생을 다시 누르면 영상을 새로 띄운다. */
    videoKey: `${url}#${round}`,
    pending: mutation.isPending,
    /** 재생 주소를 받을 때 서버가 지운 클립이라고 답했다. */
    deleted: isDeletedError(mutation.error),
    error,
    play,
    onError,
  };
}

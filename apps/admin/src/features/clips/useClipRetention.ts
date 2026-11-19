import { requestClipRetention } from '@/features/clips/api';
import { CLIP_ERROR } from '@/features/clips/constants';
import { clipsKey } from '@/features/clips/useEventClips';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/** 서버가 정한 거절 이유(409 CLIP_AUTO_RETAINED, 410 CLIP_DELETED)는 알아볼 수 있게 알린다. */
function retentionError(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === CLIP_ERROR.AUTO_RETAINED) return '자동 보존 클립은 보존 표시를 뗄 수 없습니다';
  if (code === CLIP_ERROR.DELETED) return '삭제된 클립입니다';
  return '보존 표시를 바꾸지 못했습니다';
}

/**
 * 클립 하나의 보존 표시 붙이기·떼기(관리자, 명세 11.5 아차사고). 낙관적 갱신을 하지 않는다(CONVENTION).
 * 성공하든 실패하든 목록을 다시 받아 서버가 가진 값으로 그린다. 응답은 바뀐 클립(auto_retained 포함)이지만
 * 목록 한 곳에서만 값을 읽도록 응답은 쓰지 않는다.
 */
export function useClipRetention(eventId: string, clipId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (hold: boolean) => requestClipRetention(api, clipId, hold),
    onSettled: () => queryClient.invalidateQueries({ queryKey: clipsKey(eventId) }),
  });
  return {
    setRetention: (hold: boolean) => mutation.mutate(hold),
    pending: mutation.isPending,
    error: mutation.isError ? retentionError(mutation.error) : undefined,
  };
}

import { deleteStaticObject, STATIC_OBJECTS_KEY } from '@/features/surfaces/api';
import { removeSurfaceCached } from '@/features/zones/commitCache';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/http';
import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, needsRefetch } from '@/lib/writeFailure';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const FORBIDDEN_TEXT = '작업면을 삭제할 권한이 없습니다.';
const NOT_FOUND_TEXT = '이미 없거나 보관된 작업면입니다. 목록을 다시 받았습니다.';
const OUTCOME_UNKNOWN_TEXT =
  '삭제됐는지 확인하지 못해 목록을 다시 받았습니다. 확인한 뒤 다시 시도하세요.';
const FALLBACK_TEXT = '작업면을 삭제하지 못했습니다. 다시 시도하세요.';

/** 작업면 삭제(보관) 실패를 화면 알림 문구로. 서버가 자체 문구를 줘도 보이지 않는다. */
export function archiveErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return FALLBACK_TEXT;
  if (error.status === HTTP_FORBIDDEN) return FORBIDDEN_TEXT;
  if (error.status === HTTP_NOT_FOUND) return NOT_FOUND_TEXT;
  return needsRefetch(error) ? OUTCOME_UNKNOWN_TEXT : FALLBACK_TEXT;
}

/**
 * 구역에 이어지지 않은 작업면을 보관(삭제)한다(DELETE /api/static-objects/{id}). 성공하면 목록에서 빼고, 실패했는데 서버
 * 상태를 모르면(없어짐·서버 오류·응답 없음) 목록을 다시 받는다. 현장 판정으로 보내는 발행은 부르는 쪽이 이어서 한다.
 */
export function useSurfaceArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (objectId: string) => deleteStaticObject(api, objectId),
    onSuccess: (_, objectId) => removeSurfaceCached(queryClient, objectId),
    onError: (error) => {
      if (needsRefetch(error)) void queryClient.invalidateQueries({ queryKey: STATIC_OBJECTS_KEY });
    },
  });
}

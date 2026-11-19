import { ApiError } from '@/lib/http';

// 구역·작업면 저장(PUT·POST·DELETE) 실패를 가리는 공통 규칙. 두 저장 훅이 함께 쓴다.

/** HTTP 상태: 권한 없음, 없음, 다른 요청이 먼저 새 버전을 만듦. */
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
/** 이 상태부터는 서버 오류다. */
const HTTP_SERVER_ERROR_MIN = 500;

/** 응답을 받지 못했거나 읽지 못해 서버에 저장됐는지 모르는 실패. */
export const outcomeUnknown = (error: unknown) =>
  error instanceof ApiError && error.kind !== 'HTTP';

/** 목록을 다시 받아야 하는 실패: 다른 요청이 먼저 새 버전을 만듦(409), 없어짐(404), 저장됐는지 모름, 서버 오류. */
export const needsRefetch = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === HTTP_CONFLICT ||
    error.status === HTTP_NOT_FOUND ||
    error.status >= HTTP_SERVER_ERROR_MIN ||
    outcomeUnknown(error));

/** 검사하지 않은 목록 항목에서 칸 하나를 읽는다. 객체가 아니면 undefined. */
export const fieldOf = (item: unknown, key: string): unknown =>
  typeof item === 'object' && item !== null ? Reflect.get(item, key) : undefined;

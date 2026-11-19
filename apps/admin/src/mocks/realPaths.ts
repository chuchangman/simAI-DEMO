interface PathHandler {
  info: { path?: unknown };
}

/**
 * 실서버로 보낼 경로(VITE_API_REAL)의 mock handler 를 뺀다. 빠진 경로의 요청은 처리되지 않은 요청이 되어
 * msw 가 그대로 내보낸다(onUnhandledFrame: 'bypass', 개발 서버 프록시가 실서버로 넘긴다).
 * 경로는 앞의 * 를 떼고 접두어로 맞춘다: /api/auth 는 /api/auth/login 을 빼고 /api/authority 는 두지 않는다.
 */
export function withoutRealPaths<T extends PathHandler>(
  handlers: readonly T[],
  realPaths: readonly string[],
): T[] {
  return handlers.filter((handler) => {
    const { path } = handler.info;
    if (typeof path !== 'string') return true;
    const bare = path.replace(/^\*/, '');
    return !realPaths.some((real) => bare === real || bare.startsWith(`${real}/`));
  });
}

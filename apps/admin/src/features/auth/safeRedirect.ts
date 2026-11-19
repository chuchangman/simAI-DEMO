// 탭·줄바꿈은 브라우저가 URL 에서 지워 버려서 /\t/host 가 //host(다른 사이트)로 읽힌다. 역슬래시도 / 로 읽힌다.
function hasControlOrBackslash(value: string) {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '\\') return true;
  }
  return false;
}

// 로그인 뒤 돌아갈 곳은 이 앱 안의 경로만 받는다. 문자열 모양만 보지 않고 URL 로 풀어 출처(origin)를 비교한다.
export function safeRedirect(target: string | undefined, origin: string): string {
  if (!target?.startsWith('/') || hasControlOrBackslash(target)) return '/';
  let url: URL;
  try {
    url = new URL(target, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  // /.//host 처럼 점 경로를 풀면 //host 가 되는 값은 주소로 쓰면 다시 다른 사이트가 된다.
  if (url.pathname.startsWith('//')) return '/';
  if (url.pathname === '/login' || url.pathname === '/login/') return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ });

// 운영 빌드를 내 PC 에서 띄워 볼 때(vite preview)만 암호화 없는 http·ws 를 허용한다.
// CCTV 로컬 미리보기는 같은 노트북의 중계(gateway/relay, 127.0.0.1 에서만 들음)에만 붙는다.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** gateway/relay preview.DEFAULT_PREVIEW_PORT 와 같은 포트. */
export const DEFAULT_CCTV_PREVIEW_URL = 'ws://127.0.0.1:47032';

const schema = z.object({
  // 비우면 화면과 같은 출처로 부른다(운영 nginx, 개발 서버 프록시).
  // 뒤에 /api/… 를 그대로 이어 붙이므로 ? 나 # 가 있으면 경로가 쿼리·조각으로 들어간다.
  VITE_API_BASE_URL: z
    .string({ error: '값이 없다. 같은 출처로 부르려면 빈 값으로 둔다(VITE_API_BASE_URL=)' })
    .refine((value) => value === '' || httpUrl.safeParse(value).success, {
      error: '비우거나(같은 출처) http(s) 주소를 쓴다',
      abort: true,
    })
    .refine((value) => !/[?#]/.test(value), '? 나 # 없이 주소만 쓴다'),
  VITE_STOMP_URL: z.url({ protocol: /^wss?$/, error: 'ws(s) 주소여야 한다' }),
  // 현장 노트북 CCTV 로컬 미리보기(중계 --preview-port). 같은 노트북에서만 붙으므로 루프백 주소만 받는다
  // (노트북 밖에서는 EC2 원격 시청으로 붙는다, features/cctv/cctvView.ts).
  // 비우거나 없으면 기본값.
  VITE_CCTV_PREVIEW_URL: z
    .string()
    .default('')
    .transform((value) => value.trim() || DEFAULT_CCTV_PREVIEW_URL)
    .pipe(
      z
        .url({ protocol: /^wss?$/, error: 'ws(s) 주소여야 한다' })
        .refine((value) => LOCAL_HOSTS.has(new URL(value).hostname), {
          error: '같은 노트북(127.0.0.1·localhost·[::1]) 주소만 쓴다',
        }),
    ),
  // true 면 개발 서버에서 msw 가 REST·STOMP 를 흉내 낸다. 빌드에는 들어가지 않는다.
  VITE_API_MOCK: z
    .enum(['true', 'false'], { error: 'true 또는 false 여야 한다' })
    .default('false')
    .transform((value) => value === 'true'),
  // mock 을 켠 채 실서버로 보낼 경로(쉼표로 나눈다). 예: /api/auth 면 로그인·갱신·로그아웃만 실서버로 간다.
  VITE_API_REAL: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((path) => path.trim())
        .filter((path) => path !== ''),
    )
    .pipe(z.array(z.string().regex(/^\/api(\/[a-z0-9-]+)+$/, '/api/… 경로를 쉼표로 나눠 쓴다'))),
});

export type Env = z.infer<typeof schema>;

function isCleartextRemote(value: string) {
  // 빈 값은 화면과 같은 출처다. 화면이 https 면 API 도 https 다.
  if (value === '') return false;
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'ws:') && !LOCAL_HOSTS.has(url.hostname);
}

export function parseEnv(raw: Record<string, unknown>, { production = false } = {}): Env {
  const result = schema.safeParse(raw);
  const lines = result.success
    ? []
    : result.error.issues.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`);
  if (result.success && production) {
    for (const key of ['VITE_API_BASE_URL', 'VITE_STOMP_URL'] as const) {
      if (isCleartextRemote(result.data[key])) {
        lines.push(
          `- ${key}: 운영 빌드에서는 https·wss 주소여야 한다(비밀번호·토큰이 암호화 없이 오간다)`,
        );
      }
    }
  }
  if (!result.success || lines.length > 0) {
    throw new Error(
      `환경변수가 비었거나 형식이 틀렸다. apps/admin/.env.example 을 .env.local 로 복사해 채운다.\n${lines.join('\n')}`,
    );
  }
  return result.data;
}

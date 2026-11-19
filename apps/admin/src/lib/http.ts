import type { ZodType } from 'zod';

/** 서버 응답을 받지 못했을 때(서버 꺼짐, 네트워크 끊김, 시간 초과)의 `ApiError.status`. */
export const NETWORK_ERROR = 0;

/**
 * 실패 종류.
 * - HTTP: 서버가 오류 상태(4xx·5xx)로 답했다.
 * - NETWORK: 연결이 안 됐다.
 * - TIMEOUT: 정한 시간 안에 답이 끝나지 않았다.
 * - INVALID_RESPONSE: 성공 상태인데 본문이 JSON 이 아니거나 스키마와 다르다.
 */
export type ApiErrorKind = 'HTTP' | 'NETWORK' | 'TIMEOUT' | 'INVALID_RESPONSE';

export interface ApiErrorOptions {
  kind?: ApiErrorKind;
  /** 서버가 보낸 오류 문구. 보여 줄지는 훅이 정한다(5xx 문구에는 서버 내부 정보가 섞일 수 있다). */
  serverMessage?: string;
  /** 서버가 정한 오류 이름(ProblemDetail 의 code). 예: REFRESH_TOKEN_ROTATED */
  code?: string;
  /** ProblemDetail 에 함께 실린 request_id 등 부가 식별자. */
  requestId?: number;
  /** ProblemDetail 에 함께 실린 진행 중 작업 식별자·이름(있을 때만). */
  workId?: number;
  workName?: string;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly serverMessage?: string;
  readonly code?: string;
  readonly requestId?: number;
  readonly workId?: number;
  readonly workName?: string;

  constructor(
    status: number,
    { kind, serverMessage, code, requestId, workId, workName, cause }: ApiErrorOptions = {},
  ) {
    const resolved = kind ?? (status === NETWORK_ERROR ? 'NETWORK' : 'HTTP');
    // 서버 문구는 message 에 넣지 않는다. 로그·오류 화면으로 서버 내부 정보가 새지 않게 한다.
    super(`요청이 실패했다 (${resolved === 'HTTP' ? `HTTP ${status}` : resolved})`, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.kind = resolved;
    this.serverMessage = serverMessage;
    this.code = code;
    this.requestId = requestId;
    this.workId = workId;
    this.workName = workName;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  method?: Method;
  body?: unknown;
  /** 응답 본문 검사. 통과한 값만 돌려준다. */
  schema: ZodType<T>;
  /** 바이너리 자산은 JSON 변환 없이 읽고 schema 로 검사한다. */
  responseType?: 'json' | 'arrayBuffer';
  signal?: AbortSignal;
  /** 쿠키를 실을지. 갱신 쿠키를 주고받는 인증 요청만 'include' 로 부른다. */
  credentials?: RequestCredentials;
}

export type Http = <T>(path: string, options: RequestOptions<T>) => Promise<T>;

export interface HttpOptions {
  baseUrl: string;
  getToken?: () => string | undefined;
  /**
   * 토큰을 실어 보낸 요청이 401 이면 그 토큰을 넘겨 새 토큰을 받는다. 다른 토큰이 오면 요청을 한 번만 다시 보낸다.
   * 못 받으면 원래 401 을 던진다. 세션을 끝낼지는 이 함수가 정한다.
   */
  refreshToken?: (token: string) => Promise<string | undefined>;
  /** 토큰을 실어 보낸 요청이 401 인데 더 갱신하지 않을 때 그 토큰을 넘겨 부른다(refreshToken 이 없거나, 다시 보낸 요청도 401). */
  onUnauthorized?: (token: string) => void;
  /** 요청 하나가 끝나기까지 기다리는 시간(ms). 서버가 멈춰도 화면이 "요청 중"에 머물지 않게 한다. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// import.meta.env 를 읽지 않는다. 주소와 토큰은 부르는 쪽(lib/api.ts)이 넘긴다.
export function createHttp({
  baseUrl,
  getToken,
  refreshToken,
  onUnauthorized,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: HttpOptions): Http {
  const base = baseUrl.replace(/\/+$/, '');

  return async (
    path,
    { method = 'GET', body, schema, responseType = 'json', signal, credentials },
  ) => {
    // base 뒤에 붙이므로 / 로 시작해야 한다. '@host/…' 같은 값은 http://base@host/… 가 되어 토큰이 다른 서버로 간다.
    // base 가 비면(같은 출처) 주소 해석이 '/\host'·탭·줄바꿈이 낀 '//host' 를 다른 호스트로 읽어서 그런 글자도 받지 않는다.
    if (!path.startsWith('/') || path.startsWith('//') || hasUnsafeChar(path)) {
      throw new Error(`REST 경로는 / 로 시작해야 한다: ${path}`);
    }
    // 직렬화 오류(순환 참조 등)는 코드 문제라 연결 실패로 바꾸지 않는다.
    const payload = body === undefined ? undefined : JSON.stringify(body);

    // 보낼 때마다 시간 제한을 새로 둔다. 갱신을 기다린 시간이 다시 보내는 요청의 몫을 먹지 않게 한다.
    const send = async (token: string | undefined) => {
      const headers = new Headers({
        Accept: responseType === 'arrayBuffer' ? 'application/octet-stream' : 'application/json',
      });
      if (payload !== undefined) headers.set('Content-Type', 'application/json');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(`${base}${path}`, {
          method,
          headers,
          body: payload,
          credentials,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const binary = response.ok && responseType === 'arrayBuffer';
        return {
          response,
          text: binary ? '' : await response.text(),
          buffer: binary ? await response.arrayBuffer() : undefined,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError(NETWORK_ERROR, {
          kind: timeout.aborted ? 'TIMEOUT' : 'NETWORK',
          cause: error,
        });
      }
    };

    const token = getToken?.();
    let { response, text, buffer } = await send(token);
    if (response.status === 401 && token) {
      if (refreshToken) {
        // 401 은 서버 보안 필터가 요청을 처리하기 전에 거절한 것이라 POST 도 다시 보내도 된다.
        const next = await refreshToken(token).catch(() => undefined);
        if (signal?.aborted) throw signal.reason;
        if (next && next !== token) {
          ({ response, text, buffer } = await send(next));
          if (response.status === 401) onUnauthorized?.(next);
        }
      } else {
        onUnauthorized?.(token);
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, readProblem(text));
    }
    let data: unknown;
    try {
      data = responseType === 'arrayBuffer' ? buffer : text === '' ? undefined : JSON.parse(text);
    } catch (error) {
      throw new ApiError(response.status, { kind: 'INVALID_RESPONSE', cause: error });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(response.status, { kind: 'INVALID_RESPONSE', cause: parsed.error });
    }
    return parsed.data;
  };
}

// 역슬래시와 제어 문자(탭·줄바꿈 등). URL 해석이 지우거나 / 로 바꿔 경로가 다른 호스트로 바뀔 수 있다.
function hasUnsafeChar(path: string) {
  return [...path].some((char) => {
    const code = char.charCodeAt(0);
    return char === '\\' || code < 0x20 || code === 0x7f;
  });
}

// Spring 기본 오류 본문(message)과 ProblemDetail(detail·code·request_id·work_id·work_name)을 읽는다.
function readProblem(
  text: string,
): Pick<ApiErrorOptions, 'serverMessage' | 'code' | 'requestId' | 'workId' | 'workName'> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const problem: object = data;
  const field = (key: string) => {
    const value: unknown = Reflect.get(problem, key);
    return typeof value === 'string' && value ? value : undefined;
  };
  const numField = (key: string) => {
    const value: unknown = Reflect.get(problem, key);
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
  };
  return {
    serverMessage: field('message') ?? field('detail'),
    code: field('code'),
    requestId: numField('request_id'),
    workId: numField('work_id'),
    workName: field('work_name'),
  };
}

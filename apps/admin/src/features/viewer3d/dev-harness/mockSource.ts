import type {
  SourceConnectionChange,
  SpatialSource,
  SpatialSourceSink,
  ZonesResult,
} from '@/features/viewer3d/data/spatialSource';
import {
  DEMO_STATIC_OBJECTS_BE_V1,
  type GeometryMode,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  DEMO_OPERATIONAL_GEOMETRY,
  scenarioTick,
  TICK_MS,
  type ScenarioKey,
} from '@/features/viewer3d/dev-harness/scenarios';

// 개발·시험 전용 10 Hz Mock Source. 시나리오를 재생해 외부 Live 와 같은 SpatialSource 경계로 넘긴다.
// 실제 STOMP 서버를 흉내 내지 않는다. 구역·스냅샷은 REST(개발 서버에서는 MSW)로 받아 실제 경로와 같게 둔다.

export interface MockSourceOptions {
  scenario: ScenarioKey;
  /** 시나리오 tick 0 의 시각(UTC ms). 없으면 만들 때의 now(). */
  t0?: number;
  now?: () => number;
  /** REST 기준 주소. '' 는 같은 출처, null 이면 REST 를 쓰지 않는다. */
  restBase?: string | null;
  /** true 면 메시지를 JSON 문자열로 바꿨다가 다시 읽어 STOMP 본문처럼 넘긴다. */
  serialize?: boolean;
  /** NOT_JSON(MSW 미응답)일 때 Mock 을 다시 켠다. 개발 서버의 startSpatialMocks 가 준다. */
  reactivateMocks?: () => Promise<void>;
  /** 이 tick 에 이르면 재생을 멈춘다(개발 시연 상한). 없으면 계속 재생한다. */
  maxTicks?: number;
  /** 작업면·정적 객체 형식(-234). demo 는 구성 묶음 모양, official 은 BE GET /api/static-objects 배열이다. */
  geometry?: GeometryMode;
}

export interface MockSpatialSource extends SpatialSource {
  readonly kind: 'MOCK';
  readonly scenario: ScenarioKey;
  readonly t0: number;
  /** 다음에 내보낼 tick. */
  readonly tick: number;
  readonly halted: boolean;
  /** 재생 상한에 이르러 멈췄다. */
  readonly capped: boolean;
  readonly subscriberCount: number;
  /** 지금 돌고 있는 타이머 수(0 또는 1). 누수 확인용이다. */
  readonly timerCount: number;
  pause(): void;
  resume(): void;
  /** 멈춘 상태에서 tick 을 n 개 내보낸다. */
  step(n?: number): void;
}

let created = 0;

/**
 * 요청이 MSW 를 거치지 않고 Vite 로 가면 index.html 이 온다. 그 응답을 JSON 으로 읽지 않고 이 이유로 남긴다.
 * 원인: 서비스 워커가 유휴로 종료됐다 다시 뜨면 활성 페이지 목록이 비어 요청을 그대로 넘긴다(페이지 쪽 MSW 는 켜진 줄 안다).
 * HMR 로 MSW 를 껐다 켜는 사이에 보낸 요청도 같다.
 */
export const NOT_JSON_REASON = 'JSON 이 아닌 응답(MSW 미동작 추정)';
/** NOT_JSON 일 때 Mock 을 다시 켜고(reactivateMocks) 다시 묻는 횟수와 간격. HTTP 오류(503 등)는 실제 실패라 다시 묻지 않는다. */
const RECOVER_ATTEMPTS = 3;
const RECOVER_WAIT_MS = 200;

export function createMockSource(options: MockSourceOptions): MockSpatialSource {
  const now = options.now ?? Date.now;
  const t0 = options.t0 ?? now();
  const restBase = options.restBase ?? null;
  const id = `mock:${options.scenario}:${++created}`;
  const sinks = new Set<SpatialSourceSink>();
  let connection: SourceConnectionChange = { state: 'CONNECTING', at: now() };
  let tick = 0;
  let halted = false;
  let capped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let opened = false;

  const each = (fn: (sink: SpatialSourceSink) => void) => [...sinks].forEach(fn);
  const copy = (raw: unknown) => (options.serialize ? JSON.parse(JSON.stringify(raw)) : raw);

  const setConnection = (change: SourceConnectionChange) => {
    connection = change;
    each((sink) => sink.onConnectionChange(change));
  };

  async function fetchJson(
    path: string,
  ): Promise<{ ok: true; raw: unknown } | { ok: false; reason: string }> {
    try {
      const response = await fetch(`${restBase}${path}`);
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      if (!(response.headers.get('content-type') ?? '').includes('json')) {
        return { ok: false, reason: NOT_JSON_REASON };
      }
      return { ok: true, raw: await response.json() };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '요청 실패' };
    }
  }

  /** REST 요청. Mock 이 응답하지 않았으면(NOT_JSON) Mock 을 다시 켜고 다시 묻는다. 구독이 모두 풀렸으면 그만둔다. */
  async function get(path: string): Promise<ZonesResult> {
    let result: ZonesResult = await fetchJson(path);
    for (let attempt = 1; attempt <= RECOVER_ATTEMPTS; attempt++) {
      if (result.ok || result.reason !== NOT_JSON_REASON || sinks.size === 0) break;
      await options.reactivateMocks?.();
      await new Promise((resolve) => setTimeout(resolve, RECOVER_WAIT_MS * attempt));
      if (sinks.size === 0) break;
      result = await fetchJson(path);
    }
    return result;
  }

  // 연결이 열릴 때마다 지금 시각 World 스냅샷을 받아 공백을 메운다. 구역은 처음 한 번 받는다.
  async function onOpen(first: boolean) {
    if (restBase === null) return;
    if (first) {
      const zones = await get('/api/zones');
      each((sink) => sink.onZones?.(zones, now()));
    }
    const snapshot = await get(`/api/world?at=${t0 + Math.max(tick - 1, 0) * TICK_MS}`);
    if (snapshot.ok) each((sink) => sink.onMessage(copy(snapshot.raw), now()));
  }

  function emit() {
    // 개발 시연 상한. 더 재생하지 않고 멈춘다(연결은 그대로라 World 연령이 늘어난다).
    if (options.maxTicks !== undefined && tick >= options.maxTicks) {
      capped = true;
      halted = true;
      stopTimer();
      return;
    }
    for (const out of scenarioTick(options.scenario, tick, t0)) {
      if (out.type === 'connection') {
        setConnection({ state: out.state, at: now(), reason: out.reason });
        if (out.state === 'OPEN') void onOpen(false);
      } else {
        const raw = copy(out.raw);
        const at = now();
        each((sink) => sink.onMessage(raw, at));
      }
    }
    tick += 1;
  }

  const startTimer = () => {
    if (timer === null && !halted && sinks.size > 0) timer = setInterval(emit, TICK_MS);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  return {
    id,
    kind: 'MOCK',
    scenario: options.scenario,
    t0,
    get tick() {
      return tick;
    },
    get halted() {
      return halted;
    },
    get capped() {
      return capped;
    },
    get subscriberCount() {
      return sinks.size;
    },
    get timerCount() {
      return timer === null ? 0 : 1;
    },
    subscribe(sink) {
      sinks.add(sink);
      sink.onConnectionChange(connection);
      // 등록 작업면(-188)·정적 객체(-274)는 Viewer 로 넘기는 경로가 아직 없어 구독마다 DEMO 묶음을 바로 넘긴다
      // (같은 값이라 다시 받아도 그대로다).
      const geometryRaw =
        options.geometry === 'official' ? DEMO_STATIC_OBJECTS_BE_V1 : DEMO_OPERATIONAL_GEOMETRY;
      sink.onWorkSurfaces?.({ ok: true, raw: copy(geometryRaw) }, now());
      if (!opened) {
        opened = true;
        setConnection({ state: 'OPEN', at: now(), reason: 'Mock 시작' });
        void onOpen(true);
      }
      startTimer();
      return () => {
        sinks.delete(sink);
        if (sinks.size === 0) stopTimer();
      };
    },
    pause() {
      halted = true;
      stopTimer();
    },
    resume() {
      halted = false;
      startTimer();
    },
    step(n = 1) {
      for (let i = 0; i < n; i++) emit();
    },
  };
}

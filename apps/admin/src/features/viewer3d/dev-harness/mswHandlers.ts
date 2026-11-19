import {
  DENSE_ASSET_VERSION,
  getSyntheticAvatarPngPair,
} from '@/features/viewer3d/dev-harness/avatarFixture';
import syntheticMhrDenseUrl from '@/features/viewer3d/dev-harness/fixtures/synthetic-mhr-dense.glb?url';
import syntheticMhrUrl from '@/features/viewer3d/dev-harness/fixtures/synthetic-mhr.glb?url';
import {
  DEMO_ZONES_BE_V1,
  type GeometryMode,
} from '@/features/viewer3d/dev-harness/officialFixtures';
import {
  DEMO_ZONES_RESPONSE,
  isScenarioKey,
  scenarioWorld,
  TICK_MS,
  type ScenarioKey,
} from '@/features/viewer3d/dev-harness/scenarios';
import { bypass, delay, http, HttpResponse } from 'msw';

// Spatial 개발 화면 전용 REST Mock. 앱 공용 핸들러(src/mocks/handlers.ts)와 따로 두고 개발 화면 진입점에서만 켠다.
// 응답은 MockSource 스트림과 같은 시나리오 데이터(scenarios.ts)에서 나온다. 경로는 명세 12.6 기본안이다.

/** none 정상, error 503, slow 지연, nonjson 200 이지만 HTML(MSW 를 거치지 않은 Vite 응답과 같은 모양). */
export type MockFailure = 'none' | 'error' | 'slow' | 'nonjson';

export interface SpatialMockApi {
  handlers: ReturnType<typeof http.get>[];
  /** 지금 재생 중인 시나리오와 tick 0 시각. 스냅샷을 같은 시나리오에서 만들기 위해 맞춘다. */
  setScenario(scenario: ScenarioKey, t0: number): void;
  setFailure(mode: MockFailure): void;
  readonly failure: MockFailure;
  /** 구역 응답 형식(-234). demo 는 DEMO 상자 묶음, official 은 BE GET /api/zones 배열이다. */
  setGeometry(mode: GeometryMode): void;
  readonly geometry: GeometryMode;
  /**
   * 서비스 워커가 이 페이지의 Mock 활성화를 잃었을 때 다시 켠다(disable → enable 로 MOCK_ACTIVATE 를 다시 보낸다).
   * 워커는 유휴로 종료됐다 다시 뜨면 활성 페이지 목록(메모리)이 비어 모든 요청을 그대로 넘기고, 그러면 Vite 가 index.html 을 준다.
   * 동시에 여러 번 불러도 한 번만 돈다. 재활성 수단이 없으면(시험·Node) 아무것도 하지 않는다.
   */
  reactivate(): Promise<void>;
  /** 재활성한 횟수(진단용). */
  readonly reactivations: number;
  setReactivator(fn: (() => Promise<void>) | null): void;
}

export function createSpatialMockApi(initial: {
  scenario: ScenarioKey;
  t0: number;
  slowMs?: number;
  geometry?: GeometryMode;
}): SpatialMockApi {
  let scenario = initial.scenario;
  let t0 = initial.t0;
  let failure: MockFailure = 'none';
  let geometry: GeometryMode = initial.geometry ?? 'demo';
  const slowMs = initial.slowMs ?? 1500;
  let reactivator: (() => Promise<void>) | null = null;
  let pending: Promise<void> | null = null;
  let reactivations = 0;

  const failOrWait = async () => {
    if (failure === 'error') {
      return HttpResponse.json({ message: 'Mock: 서버 오류' }, { status: 503 });
    }
    if (failure === 'nonjson') {
      return HttpResponse.html('<!doctype html><title>Mock: HTML 응답</title>');
    }
    if (failure === 'slow') await delay(slowMs);
    return null;
  };

  // 경로 앞의 * 는 기준 주소가 무엇이든 맞추려는 것이다(앱 핸들러와 같은 방식).
  const handlers = [
    http.get('*/api/world', async ({ request }) => {
      const failed = await failOrWait();
      if (failed) return failed;
      const url = new URL(request.url);
      const requested = url.searchParams.get('scenario');
      const key = isScenarioKey(requested) ? requested : scenario;
      const at = Number(url.searchParams.get('at'));
      if (!url.searchParams.has('at') || !Number.isFinite(at)) {
        return HttpResponse.json({ message: 'at 은 UTC 밀리초 숫자다' }, { status: 400 });
      }
      if (at < t0)
        return HttpResponse.json({ message: '그 시각의 데이터가 없다' }, { status: 404 });
      return HttpResponse.json(scenarioWorld(key, Math.floor((at - t0) / TICK_MS), t0));
    }),
    http.get('*/api/zones', async () => {
      const failed = await failOrWait();
      if (failed) return failed;
      return HttpResponse.json(geometry === 'official' ? DEMO_ZONES_BE_V1 : DEMO_ZONES_RESPONSE);
    }),
    // EXP-02 아바타 자산(-65). 버전 0 은 합성 리그 GLB, 1 은 실제 MHR 크기의 dense 합성 리그, 그 밖의 버전은 없는 자산(404)이다.
    // REST 실패 시험(503 등)과는 따로 둔다.
    http.get(
      '*/api/avatars/:worldId/epochs/:epoch/versions/:version/mesh.glb',
      async ({ params }) => {
        const dense = params.version === String(DENSE_ASSET_VERSION);
        if (params.version !== '0' && !dense) {
          return HttpResponse.json({ message: 'Mock: 자산 없음' }, { status: 404 });
        }
        const file = await fetch(bypass(dense ? syntheticMhrDenseUrl : syntheticMhrUrl));
        return new HttpResponse(await file.arrayBuffer(), {
          headers: { 'content-type': 'model/gltf-binary' },
        });
      },
    ),
    // EXP-02 아바타 합성 텍스처(-359). 버전 0·1 은 코드로 생성한 PNG 바이트, 그 밖의 버전은 404 다.
    http.get('*/api/avatars/:worldId/epochs/:epoch/versions/:version/albedo.png', ({ params }) => {
      const dense = params.version === String(DENSE_ASSET_VERSION);
      if (params.version !== '0' && !dense) {
        return HttpResponse.json({ message: 'Mock: 외형 텍스처 없음' }, { status: 404 });
      }
      const { albedoPng } = getSyntheticAvatarPngPair(
        String(params.worldId),
        Number(params.version),
      );
      return new HttpResponse(new Uint8Array(albedoPng), {
        headers: { 'content-type': 'image/png' },
      });
    }),
    http.get(
      '*/api/avatars/:worldId/epochs/:epoch/versions/:version/surface_source.png',
      ({ params }) => {
        const dense = params.version === String(DENSE_ASSET_VERSION);
        if (params.version !== '0' && !dense) {
          return HttpResponse.json({ message: 'Mock: 표면 출처 지도 없음' }, { status: 404 });
        }
        const { surfaceSourcePng } = getSyntheticAvatarPngPair(
          String(params.worldId),
          Number(params.version),
        );
        return new HttpResponse(new Uint8Array(surfaceSourcePng), {
          headers: { 'content-type': 'image/png' },
        });
      },
    ),
  ];

  return {
    handlers,
    setScenario(next, nextT0) {
      scenario = next;
      t0 = nextT0;
    },
    setFailure(mode) {
      failure = mode;
    },
    get failure() {
      return failure;
    },
    setGeometry(mode) {
      geometry = mode;
    },
    get geometry() {
      return geometry;
    },
    reactivate() {
      if (!reactivator) return Promise.resolve();
      pending ??= reactivator()
        .then(() => {
          reactivations += 1;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    get reactivations() {
      return reactivations;
    },
    setReactivator(fn) {
      reactivator = fn;
    },
  };
}

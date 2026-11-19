import { problem } from '@/mocks/problem';
import { http, HttpResponse } from 'msw/http';

// GPU 켜기·끄기·설정 mock(S15P31A101-702). 서버(domain/gpu)와 같은 모양으로 답한다. 켜면 켜는 중 → 가중치 → 엔진 → 준비 완료를
// 몇 초씩 지나 연결된다(실제는 5~7분). 끄면 꺼짐. 관제·세팅 막힘은 흉내 내지 않는다.

const STEP_MS = 4_000;

interface MockLaunch {
  launch_id: string;
  gpu_type: string;
  region: string;
  price: number;
  requestedAt: number;
}

/** startConnected: 처음부터 GPU 가 연결된 채로 시작한다(simAI-DEMO 시연 흐름). */
export function createGpuMock({ startConnected = false }: { startConnected?: boolean } = {}) {
  let launch: MockLaunch | null = startConnected
    ? {
        launch_id: crypto.randomUUID(),
        gpu_type: 'NVIDIA H100 80GB HBM3',
        region: 'AP-JP-1',
        price: 2.99,
        requestedAt: Date.now() - STEP_MS * 3,
      }
    : null;
  let settingsVersion: number | null = null;
  let settings = {
    provider: 'RUNPOD' as 'RUNPOD' | 'AWS',
    preferred_gpu_types: ['NVIDIA H100 80GB HBM3', 'NVIDIA H100 NVL', 'NVIDIA H100 PCIe'],
    preferred_regions: ['AP-JP-1', 'OC-AU-1'],
    cloud_type: 'SECURE' as 'SECURE' | 'COMMUNITY',
    interruptible: false,
    max_price_per_hour_usd: null as number | null,
    auto_stop_idle_minutes: 30,
    runpod_template_id: null as string | null,
  };
  let settingsAt: number | null = null;

  const status = () => {
    const now = Date.now();
    if (!launch) {
      return { session: null, server_time_ms: now, launch: null, power: 'OFF', stop_block: null };
    }
    const age = now - launch.requestedAt;
    const launchView = {
      launch_id: launch.launch_id,
      state: 'RUNNING',
      provider: 'RUNPOD',
      gpu_type: launch.gpu_type,
      region: launch.region,
      cloud_type: settings.cloud_type,
      interruptible: settings.interruptible,
      price_per_hour_usd: launch.price,
      requested_by: 'admin1',
      requested_at_ms: launch.requestedAt,
      instance_id: `pod-${launch.launch_id.slice(0, 6)}`,
      ended_at_ms: null,
      end_reason: null,
      failure_code: null,
    };
    if (age < STEP_MS) {
      return {
        session: null,
        server_time_ms: now,
        launch: launchView,
        power: 'STARTING',
        stop_block: null,
      };
    }
    const stage = age < STEP_MS * 2 ? 'WEIGHTS' : age < STEP_MS * 3 ? 'ENGINE' : 'READY';
    return {
      session: {
        session_id: launch.launch_id,
        state: 'ACTIVE',
        stage,
        stage_reason_code: null,
        provider: 'RUNPOD',
        instance_id: launchView.instance_id,
        gpu_type: launch.gpu_type,
        region: launch.region,
        price_per_hour_usd: launch.price,
        registered_at_ms: launch.requestedAt + STEP_MS,
        elapsed_ms: age - STEP_MS,
        tier0_link: stage === 'READY' ? 'CONNECTED' : 'DISCONNECTED',
      },
      server_time_ms: now,
      launch: launchView,
      power: stage === 'READY' ? 'CONNECTED' : 'PREPARING',
      stop_block: null,
    };
  };

  // 카탈로그 흉내(S15P31A101-705): 선호 GPU + 그 밖 몇 종. 서버처럼 추천 → VRAM 등급 → 선호 순서로 정렬해 둔다(등급 규칙은 서버 GpuTiers)
  const CATALOG = [
    { id: 'NVIDIA H200', name: 'H200 SXM', mem: 141, price: 3.99 },
    { id: 'NVIDIA H100 80GB HBM3', name: 'H100 SXM', mem: 80, price: 2.99 },
    { id: 'NVIDIA H100 NVL', name: 'H100 NVL', mem: 94, price: 2.79 },
    { id: 'NVIDIA H100 PCIe', name: 'H100 PCIe', mem: 80, price: 2.39 },
    { id: 'NVIDIA A100 80GB PCIe', name: 'A100 PCIe', mem: 80, price: 1.64 },
    { id: 'NVIDIA L40S', name: 'L40S', mem: 48, price: 0.86 },
    { id: 'NVIDIA GeForce RTX 4090', name: 'RTX 4090', mem: 24, price: 0.69 },
    { id: 'NVIDIA RTX A4000', name: 'RTX A4000', mem: 16, price: 0.25 },
  ];
  const tierOf = (mem: number) =>
    mem >= 74 ? 'RECOMMENDED' : mem >= 44 ? 'BELOW_RECOMMENDED' : mem >= 22 ? 'LIMITED' : 'RISKY';
  const recommendedOf = (name: string) => /(^|[^A-Za-z0-9])H(100|200)(?![0-9])/.test(name);
  const rows = () => {
    const known = new Set(CATALOG.map((c) => c.id));
    const all = [
      ...CATALOG,
      ...settings.preferred_gpu_types
        .filter((id) => !known.has(id))
        .map((id) => ({ id, name: id, mem: null as number | null, price: 1 })),
    ];
    const rank = (id: string) => {
      const i = settings.preferred_gpu_types.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const tierRank = (mem: number | null) =>
      mem === null
        ? 4
        : ['RECOMMENDED', 'BELOW_RECOMMENDED', 'LIMITED', 'RISKY'].indexOf(tierOf(mem));
    return all
      .map((c) => ({ ...c, rec: recommendedOf(c.name) && (c.mem === null || c.mem >= 74) }))
      .sort(
        (a, b) =>
          Number(b.rec) - Number(a.rec) ||
          tierRank(a.mem) - tierRank(b.mem) ||
          rank(a.id) - rank(b.id) ||
          (b.mem ?? -1) - (a.mem ?? -1),
      );
  };
  const stockOf = (gi: number, ri: number) =>
    gi === 1 && ri === 0 ? 'NONE' : (gi + ri) % 4 === 3 ? 'NONE' : 'HIGH';

  const offers = () => {
    const list = rows();
    const cells = list.flatMap((g, gi) =>
      settings.preferred_regions.map((r, ri) => {
        const stock = stockOf(gi, ri);
        return {
          gpu_type: g.id,
          region: r,
          stock,
          available: stock !== 'NONE',
          price_per_hour_usd: g.price,
          within_cap:
            settings.max_price_per_hour_usd === null || g.price <= settings.max_price_per_hour_usd,
        };
      }),
    );
    const usable = (id: string, r: string) =>
      cells.some((c) => c.gpu_type === id && c.region === r && c.available && c.within_cap);
    const order = [...list.filter((g) => g.rec).map((g) => g.id), ...settings.preferred_gpu_types];
    let pick: { gpu_type: string; region: string } | null = null;
    for (const id of order) {
      const r = settings.preferred_regions.find((region) => usable(id, region));
      if (r) {
        pick = { gpu_type: id, region: r };
        break;
      }
    }
    return {
      provider: settings.provider,
      cloud_type: settings.cloud_type,
      interruptible: settings.interruptible,
      max_price_per_hour_usd: settings.max_price_per_hour_usd,
      gpu_types: list.map((g) => ({
        gpu_type: g.id,
        name: g.name,
        memory_gb: g.mem,
        preferred: settings.preferred_gpu_types.includes(g.id),
        recommended: g.rec,
        tier: g.mem === null ? null : tierOf(g.mem),
        available: cells.some((c) => c.gpu_type === g.id && c.available),
      })),
      regions: settings.preferred_regions.map((r) => ({ region: r, name: r, preferred: true })),
      cells,
      default: pick,
      fetched_at_ms: Date.now(),
    };
  };

  const settingsView = () => ({
    version_id: settingsVersion,
    ...settings,
    created_at_ms: settingsAt,
  });

  const handlers = [
    http.get('*/api/gpu/sessions/current', () => HttpResponse.json(status())),
    http.get('*/api/gpu/offers', () => HttpResponse.json(offers())),
    http.post('*/api/gpu/launches', async ({ request }) => {
      if (launch) return problem(409, 'GPU_ALREADY_ON', 'GPU 가 이미 켜져 있거나 켜는 중입니다');
      const body = (await request.json().catch(() => ({}))) as {
        gpu_type?: string;
        region?: string;
      };
      const o = offers();
      const pick =
        body.gpu_type && body.region ? { gpu_type: body.gpu_type, region: body.region } : o.default;
      if (!pick) return problem(409, 'GPU_OUT_OF_STOCK', '재고가 없습니다');
      const cell = o.cells.find((c) => c.gpu_type === pick.gpu_type && c.region === pick.region);
      launch = {
        launch_id: crypto.randomUUID(),
        gpu_type: pick.gpu_type,
        region: pick.region,
        price: cell?.price_per_hour_usd ?? 2.99,
        requestedAt: Date.now(),
      };
      return HttpResponse.json(status().launch, { status: 201 });
    }),
    http.post('*/api/gpu/stop', () => {
      if (!launch) return problem(409, 'GPU_NOT_ON', '켜져 있는 GPU 가 없습니다');
      launch = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/gpu/presence', () => new HttpResponse(null, { status: 204 })),
    http.get('*/api/gpu/settings', () =>
      HttpResponse.json({
        settings: settingsView(),
        providers: [
          { id: 'RUNPOD', configured: true },
          { id: 'AWS', configured: false },
        ],
      }),
    ),
    http.post('*/api/gpu/settings', async ({ request }) => {
      settings = { ...settings, ...((await request.json()) as typeof settings) };
      settingsVersion = (settingsVersion ?? 0) + 1;
      settingsAt = Date.now();
      return HttpResponse.json(settingsView(), { status: 201 });
    }),
  ];
  return { handlers };
}

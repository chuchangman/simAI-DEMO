import type { EventEntry } from '@/features/events/entries';
import { AppliedStatusCard } from '@/features/work/run/AppliedStatusCard';
import { EventListCard } from '@/features/work/run/EventListCard';
import { RunStatusCard } from '@/features/work/run/RunStatusCard';
import { ZONES_KEY } from '@/features/zones/api';
import { MOCK_ZONES } from '@/mocks/zones';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 작업 종료 단계 오른쪽 카드 셋. 관제 데이터 훅은 대역으로 바꿔 값마다 줄이 어떻게 보이는지 본다.

const START = new Date(2026, 10, 11, 9, 0).getTime();
const NOW = START + 125_000;
const data = vi.hoisted(() => ({
  entries: [] as EventEntry[],
  scene: null as unknown,
  zonesRaw: undefined as unknown,
  zoneCount: 0,
  cameras: [] as { id: string }[],
  down: [] as string[],
  bundles: undefined as unknown[] | undefined,
}));

vi.mock('@/features/layout/useNow', () => ({ useNow: () => NOW }));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: data.entries, loaded: true, failed: false }),
}));
vi.mock('@/features/layout/useCurrentScene', () => ({
  useCurrentScene: () => ({
    scene: data.scene,
    sceneStatus: null,
    onSceneStatusChange: () => undefined,
  }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({
    zones: Array.from({ length: data.zoneCount }, () => ({})),
    raw: data.zonesRaw,
    failed: false,
  }),
}));
vi.mock('@/features/zones/useRecentBundles', async (orig) => {
  const actual = await orig<typeof import('@/features/zones/useRecentBundles')>();
  return {
    ...actual,
    useRecentBundles: () => ({ data: data.bundles && actual.readBundles(data.bundles) }),
  };
});
vi.mock('@/features/cctv/useCameraStates', () => ({
  useCameraStates: () => ({
    cameras: data.cameras,
    fresh: true,
    stateOf: (id: string) => (data.down.includes(id) ? 'down' : 'live'),
  }),
}));

afterEach(() => {
  cleanup();
  data.entries = [];
  data.scene = null;
  data.zonesRaw = undefined;
  data.zoneCount = 0;
  data.cameras = [];
  data.down = [];
  data.bundles = undefined;
});

function withClient(node: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(ZONES_KEY, MOCK_ZONES);
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const entry = (
  id: string,
  raisedAt: number,
  severity: 'CRITICAL' | 'HIGH',
  zone: string | null,
): EventEntry => ({
  event: {
    event_id: id,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity,
    confidence: 'HIGH',
    needs_check: false,
    world_ids: [],
    zone_id: zone,
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: raisedAt,
  },
  stageStartedAt: null,
});

describe('RunStatusCard', () => {
  it('진행 중 · 경과 시간 · 시작 시각 · 서명 인원을 보인다', () => {
    render(<RunStatusCard day={{ actual_started_at: START }} signerCount={3} />);
    expect(screen.getByRole('heading', { name: '작업 현황' })).toBeTruthy();
    expect(screen.getByText('진행 중')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('00:02:05');
    expect(screen.getByText('시작 시각 2026-11-11 09:00')).toBeTruthy();
    expect(screen.getByText('서명 3명')).toBeTruthy();
  });

  it('서명자를 아직 모르거나 시작 기록이 없으면 그 줄을 감춘다', () => {
    render(<RunStatusCard day={{ actual_started_at: null }} signerCount={undefined} />);
    expect(screen.getByRole('timer').textContent).toBe('00:00:00');
    expect(screen.queryByText(/시작 시각/)).toBeNull();
    expect(screen.queryByText(/서명/)).toBeNull();
  });
});

describe('EventListCard', () => {
  it('시작 뒤 경보를 최근 것부터 시각·종류·구역·등급으로 보이고, 구역이 없으면 `현장` 이다', () => {
    data.entries = [
      entry('a', START + 5_000, 'CRITICAL', 'z-04'),
      entry('b', START + 65_000, 'HIGH', null),
    ];
    withClient(<EventListCard startedAt={START} />);
    const count = screen.getByText('2건 · 위험 1 · 경고 1');
    expect(count.getAttribute('title')).toContain('관제 화면의 「진행 중」');
    const rows = within(screen.getByRole('list', { name: '경보 기록 목록' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]?.textContent).toContain('추락 위험(가장자리)');
    expect(rows[0]?.textContent).toContain('현장');
    expect(rows[0]?.textContent).toContain('경고');
    expect(rows[1]?.textContent).toContain('개구부 구역');
    expect(rows[1]?.textContent).toContain('위험');
  });

  it('같은 초·같은 사람의 위험·경고 쌍은 한 줄이고 수는 두 건이다(S15P31A101-731)', () => {
    const r3 = entry('b', START + 5_400, 'HIGH', 'z-04');
    data.entries = [
      entry('a', START + 5_000, 'CRITICAL', 'z-04'),
      { ...r3, event: { ...r3.event, rule_id: 'R3' } },
    ];
    withClient(<EventListCard startedAt={START} />);
    expect(screen.getByText('2건 · 위험 1 · 경고 1')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: '경보 기록 목록' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('추락 위험(가장자리) · 고소 작업면 위');
    expect(rows[0]?.textContent).toContain('위험');
  });

  it('구역 작업이면 그 구역 경보만 센다(종료 미팅과 같은 범위)', () => {
    data.entries = [
      entry('a', START + 5_000, 'CRITICAL', 'z-04'),
      entry('b', START + 9_000, 'HIGH', 'z-02'),
    ];
    withClient(<EventListCard startedAt={START} zoneId="z-04" />);
    expect(screen.getByText('1건 · 위험 1 · 경고 0')).toBeTruthy();
  });

  it('경보가 없으면 `경보 없음`', () => {
    withClient(<EventListCard startedAt={START} />);
    expect(screen.getByText('0건')).toBeTruthy();
    expect(screen.getByText('경보 없음')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

/** 서버 묶음 하나(GET /api/config-bundles). ppe_policy.work_id 가 그 묶음의 작업이다. */
function bundle(
  version: string,
  status: string,
  workId: number | null,
  zones = 0,
  issuedAt = START,
) {
  return {
    config_version: version,
    issued_at: issuedAt,
    status,
    applied_at: status === 'APPLIED' ? issuedAt : null,
    last_ack: null,
    items: Array.from({ length: zones }, (_, i) => ({
      item_type: 'ZONE',
      item_id: `z-${i}`,
      item_version: 1,
    })),
    ppe_policy: { helmet: 'REQUIRED', vest: 'REQUIRED', work_id: workId, effective_from_ms: START },
  };
}

describe('AppliedStatusCard', () => {
  const tones = () =>
    screen
      .getAllByRole('listitem')
      .map((li) => `${li.getAttribute('data-tone')}:${li.textContent}`);

  it('이번 작업 묶음이 적용되면 경보 켜짐 · 3D · 그 묶음의 구역 수 · 카메라(끊긴 카메라가 있으면 경고)', () => {
    data.scene = { ok: true, raw: {} };
    data.bundles = [bundle('cfg-2', 'APPLIED', 9001, 5), bundle('cfg-1', 'APPLIED', null, 2)];
    data.cameras = [{ id: 'cam_A' }, { id: 'cam_B' }, { id: 'cam_C' }, { id: 'cam_D' }];
    data.down = ['cam_B', 'cam_D'];
    withClient(<AppliedStatusCard workId="9001" startedAt={START} />);
    expect(screen.getByRole('heading', { name: '관제 적용 상태' })).toBeTruthy();
    expect(tones()).toEqual([
      'ok:이번 작업 설정 현장 적용됨 · 경보 켜짐',
      'ok:3D 모델 적용됨',
      'ok:구역 5개 적용됨',
      'bad:카메라 2/4 연결',
    ]);
  });

  it('이번 작업 묶음이 아직 적용되지 않았으면 체크하지 않고 대기를 보인다(카메라 0/4 도 체크 아님)', () => {
    data.bundles = [
      bundle('cfg-2', 'PENDING', 9001, 5, Date.now()),
      bundle('cfg-1', 'APPLIED', null, 2),
    ];
    data.cameras = [{ id: 'cam_A' }, { id: 'cam_B' }];
    data.down = ['cam_A', 'cam_B'];
    withClient(<AppliedStatusCard workId="9001" startedAt={Date.now()} />);
    expect(tones()).toEqual(['wait:현장 적용 대기 · 경보 꺼짐', 'bad:카메라 0/2 연결']);
  });

  it('이번 작업 묶음이 거부되면 무엇이 / 어떻게와 「현장에 다시 보내기」를 보인다', () => {
    data.bundles = [bundle('cfg-2', 'REJECTED', 9001), bundle('cfg-1', 'APPLIED', null)];
    withClient(<AppliedStatusCard workId="9001" startedAt={START} />);
    expect(tones()).toEqual(['bad:현장 적용 거부 · 경보 꺼짐']);
    expect(screen.getByText(/이번 작업 설정을 받지 않아/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '현장에 다시 보내기' })).toBeTruthy();
  });

  it('묶음 목록을 모르면 그 줄을 감추고, 아무것도 모르면 카드를 그리지 않는다', () => {
    const { container } = withClient(<AppliedStatusCard workId="9001" startedAt={START} />);
    expect(container.textContent).toBe('');
  });
});

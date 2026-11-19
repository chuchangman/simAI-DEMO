import type { EventEntry, Incident } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { SpatialViewportHost, useSpatialViewport } from '@/features/layout/SpatialViewportHost';
import type { Viewer3DHandle, Viewer3DProps, ViewerStatus } from '@/features/viewer3d';
import { useRealtimeStore } from '@/store/realtime.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 3D 에서 사람·구역을 누르면 이벤트 묶음(person:<world_id>·zone:<zone_id>)이 선택되고, 이벤트 묶음을 누르면 3D 가 그 대상을
// 고르고 초점을 맞추는지 본다(S15P31A101-234). 3D 가 아직 준비되지 않았을 때·사람이 장면에 아직 없을 때·2D 평면을 보고 있을 때도 본다.
// 묶음 키는 실제 groupIncidents 로 만들고, 카드 모양은 EventPanel 대역이 받은 선택 키만 보인다(카드 모양에 매이지 않는다).

const ZONES_RAW = { contract: 'DEMO_UNCONFIRMED', zones: [] };
const T = 1_760_342_400_000;

const live = vi.hoisted(() => ({ entries: [] as EventEntry[] }));
vi.mock('@/features/events/useLiveEvents', () => ({
  useLiveEvents: () => ({ entries: live.entries, loaded: true, failed: false }),
}));
vi.mock('@/features/zones/useZones', () => ({
  useZones: () => ({ zones: [], raw: ZONES_RAW, failed: false }),
}));
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));
vi.mock('@/features/events/EventPanel', async () => {
  const { groupIncidents } = await import('@/features/events/events');
  return {
    EventPanel: ({
      entries,
      selectedKey,
      onSelect,
    }: {
      entries: EventEntry[];
      selectedKey: string | null;
      onSelect: (incident: Incident) => void;
    }) => (
      <ul aria-label="이벤트 묶음">
        {groupIncidents(entries).map((incident) => (
          <li key={incident.key}>
            <button
              type="button"
              aria-pressed={incident.key === selectedKey}
              onClick={() => onSelect(incident)}
            >
              {incident.key}
            </button>
          </li>
        ))}
      </ul>
    ),
  };
});

// 3D 뷰어 대역: select·focus 를 기록하고, 준비 알림은 시험이 정한다(늦게 준비되는 3D).
const fake = vi.hoisted(() => ({
  select: vi.fn(),
  focus: vi.fn(),
  autoReady: true,
  props: null as Viewer3DProps | null,
}));

function FakeViewer(props: Viewer3DProps) {
  const { ref, onStatusChange } = props;
  useImperativeHandle(
    ref,
    () =>
      ({
        select: fake.select,
        focus: fake.focus,
        clearSelection: () => ({ ok: true }),
        resetView: () => undefined,
        setMode: () => ({ ok: true }),
      }) as unknown as Viewer3DHandle,
  );
  const reported = useRef(false);
  useLayoutEffect(() => {
    fake.props = props;
    if (reported.current || !fake.autoReady) return;
    reported.current = true;
    onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
  });
  return <div data-testid="viewer3d" />;
}

const loadFake = () => Promise.resolve({ default: FakeViewer });
const readyStatus = { phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus;

function entry(change: Partial<EventItem>): EventEntry {
  const event = {
    event_id: 'e-1',
    event_sequence: 1,
    rule_id: 'R2',
    source: 'LIVE',
    lifecycle: 'RAISED',
    verification: 'VERIFIED',
    severity: 'CRITICAL',
    confidence: 'HIGH',
    needs_check: false,
    world_ids: [],
    zone_id: null,
    metrics: {},
    rationale: null,
    proposed_severity: null,
    raised_at: T,
    updated_at: T,
    ...change,
  } as EventItem;
  return { event, stageStartedAt: T };
}

const PERSON = { type: 'person', id: 'w-1' } as const;
const ZONE = { type: 'zone', id: 'z-02' } as const;

function Probe() {
  return <span data-testid="selected">{useSpatialViewport()?.selectedKey ?? ''}</span>;
}

function renderHost(loadViewer = loadFake) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <SpatialViewportHost loadViewer={loadViewer}>
      <Probe />
    </SpatialViewportHost>,
    { wrapper },
  );
}

const card = (key: string) => screen.getByRole('button', { name: key });
const pressed = (key: string) => card(key).getAttribute('aria-pressed');
const selected = () => screen.getByTestId('selected').textContent;

beforeEach(() => {
  live.entries = [
    entry({ event_id: 'e-1', world_ids: ['w-1'], zone_id: 'z-04' }),
    entry({ event_id: 'e-2', rule_id: 'R5', world_ids: [], zone_id: 'z-02' }),
  ];
  fake.select.mockReset().mockImplementation(() => ({ ok: true }));
  fake.focus.mockReset().mockImplementation(() => ({ ok: true }));
  fake.autoReady = true;
  fake.props = null;
  useRealtimeStore.setState({ ...useRealtimeStore.getInitialState(), source: null }, true);
});
afterEach(cleanup);

describe('3D 에서 누르면 이벤트 묶음이 선택된다', () => {
  it('사람을 누르면 person:<world_id> 가 선택 키가 되어 같은 묶음 카드만 선택된다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    expect(pressed('person:w-1')).toBe('false');

    act(() => fake.props?.onSelectionChange?.(PERSON));

    expect(selected()).toBe('person:w-1');
    expect(pressed('person:w-1')).toBe('true');
    expect(pressed('zone:z-02')).toBe('false');
  });

  it('구역을 누르면 zone:<zone_id> 묶음이 선택되고, 빈 곳을 누르면 선택이 풀린다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');

    act(() => fake.props?.onSelectionChange?.(ZONE));
    expect(selected()).toBe('zone:z-02');
    expect(pressed('zone:z-02')).toBe('true');
    expect(pressed('person:w-1')).toBe('false');

    act(() => fake.props?.onSelectionChange?.(null));
    expect(selected()).toBe('');
    expect(pressed('zone:z-02')).toBe('false');
  });

  it('이벤트가 없는 사람을 누르면 선택 키만 바뀌고 어느 카드도 선택되지 않는다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');
    act(() => fake.props?.onSelectionChange?.({ type: 'person', id: 'w-9' }));
    expect(selected()).toBe('person:w-9');
    expect(pressed('person:w-1')).toBe('false');
    expect(pressed('zone:z-02')).toBe('false');
  });
});

describe('이벤트 묶음을 누르면 3D 가 그 대상을 고르고 초점을 맞춘다', () => {
  it('사람 묶음은 그 사람을, 구역 묶음은 그 구역을 select 한 뒤 focus 한다', async () => {
    renderHost();
    await screen.findByTestId('viewer3d');

    act(() => card('person:w-1').click());
    expect(fake.select).toHaveBeenLastCalledWith(PERSON);
    expect(fake.focus).toHaveBeenLastCalledWith(PERSON);
    expect(selected()).toBe('person:w-1');
    expect(pressed('person:w-1')).toBe('true');

    act(() => card('zone:z-02').click());
    expect(fake.select).toHaveBeenLastCalledWith(ZONE);
    expect(fake.focus).toHaveBeenLastCalledWith(ZONE);
    expect(pressed('zone:z-02')).toBe('true');
    expect(pressed('person:w-1')).toBe('false');
  });

  it('3D 가 아직 준비되지 않았으면 선택만 먼저 보이고, 준비되면 고르고 초점을 맞춘다', async () => {
    fake.autoReady = false;
    fake.select.mockImplementation(() => ({ ok: false, reason: 'NOT_READY' }));
    renderHost();
    await screen.findByTestId('viewer3d');

    act(() => card('person:w-1').click());
    expect(pressed('person:w-1')).toBe('true');
    expect(fake.focus).not.toHaveBeenCalled();

    fake.select.mockImplementation(() => ({ ok: true }));
    act(() => fake.props?.onStatusChange?.(readyStatus));

    await waitFor(() => expect(fake.focus).toHaveBeenCalledTimes(1));
    expect(fake.select).toHaveBeenLastCalledWith(PERSON);
    expect(fake.focus).toHaveBeenLastCalledWith(PERSON);
  });

  it('사람이 장면에 아직 없으면 올라올 때까지 다시 시도해 한 번만 초점을 맞춘다', async () => {
    let calls = 0;
    fake.select.mockImplementation(() =>
      ++calls < 3 ? { ok: false, reason: 'NOT_FOUND' } : { ok: true },
    );
    renderHost();
    await screen.findByTestId('viewer3d');

    act(() => card('person:w-1').click());
    expect(fake.focus).not.toHaveBeenCalled();

    await waitFor(() => expect(fake.focus).toHaveBeenCalledTimes(1));
    expect(calls).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fake.select).toHaveBeenCalledTimes(3);
    expect(fake.focus).toHaveBeenCalledTimes(1);
  });

  it('3D 를 받지 못해 2D 평면을 보고 있어도 묶음이 선택되고, 3D 를 다시 띄우면 그 대상을 고르고 초점을 맞춘다', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let loads = 0;
      const flaky = () =>
        ++loads === 1 ? Promise.reject(new Error('chunk load failed')) : loadFake();
      renderHost(flaky);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '3D 다시 시도' })).toBeTruthy(),
      );
      expect(screen.queryByTestId('viewer3d')).toBeNull();
      expect(screen.getByRole('group', { name: '2D 평면' })).toBeTruthy();

      act(() => card('person:w-1').click());
      expect(pressed('person:w-1')).toBe('true');
      expect(selected()).toBe('person:w-1');
      expect(fake.select).not.toHaveBeenCalled();

      act(() => screen.getByRole('button', { name: '3D 다시 시도' }).click());
      await screen.findByTestId('viewer3d');
      await waitFor(() => expect(fake.focus).toHaveBeenCalledTimes(1));
      expect(fake.select).toHaveBeenLastCalledWith(PERSON);
      expect(fake.focus).toHaveBeenLastCalledWith(PERSON);
      expect(pressed('person:w-1')).toBe('true');
    } finally {
      quiet.mockRestore();
    }
  });
});

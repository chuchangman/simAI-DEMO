import type { MonitorWorks } from '@/features/monitor/useMonitorWorks';
import { PPE_OFF_SUSTAIN_MS, WorkPpeStatus } from '@/features/monitor/WorkPpeStatus';
import {
  activePpeRequirement,
  PPE_OFF_TEXT,
  PPE_PREPARING_TEXT,
  ppeOffDetail,
  ppeStatusText,
  ruleProfileText,
} from '@/features/monitor/workPpeText';
import type { PpeReceipt } from '@/features/ppe/ppeHealth';
import { readBundles } from '@/features/zones/useRecentBundles';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 관제 머리줄 보호구 상태 한 줄(S15P31A101-654, -692, -730). 작업 목록·묶음·PPE 수신은 가짜로 넣는다.
vi.mock('@/lib/api', () => ({ api: () => Promise.reject(new Error('no api in test')) }));

const state: {
  works: MonitorWorks;
  bundles: unknown[];
  receipt: PpeReceipt;
  receiptEnabled: boolean[];
} = {
  works: { state: 'loading' },
  bundles: [],
  receipt: 'unknown',
  receiptEnabled: [],
};
vi.mock('@/features/monitor/useMonitorWorks', () => ({ useMonitorWorks: () => state.works }));
vi.mock('@/features/zones/useRecentBundles', async (orig) => {
  const actual = await orig<typeof import('@/features/zones/useRecentBundles')>();
  return { ...actual, useRecentBundles: () => ({ data: actual.readBundles(state.bundles) }) };
});
vi.mock('@/features/ppe/usePpeReceipt', async (orig) => {
  const actual = await orig<typeof import('@/features/ppe/usePpeReceipt')>();
  return {
    ...actual,
    usePpeReceipt: (enabled: boolean) => {
      state.receiptEnabled.push(enabled);
      return enabled ? state.receipt : 'unknown';
    },
  };
});

const T = 1_760_342_400_000;

function bundle(version: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    config_version: version,
    issued_at: T,
    status,
    applied_at: T,
    last_ack: null,
    items: [],
    ...extra,
  };
}

const policy = (workId: number | null, helmet: string, vest: string) => ({
  helmet,
  vest,
  work_id: workId,
  effective_from_ms: T,
});

const work = (id: number, extra: Record<string, unknown> = {}) =>
  ({ work_id: String(id), status: 'IN_PROGRESS', ...extra }) as never;

const CLASSROOM = '교실 시험 기준 · 높이차 0.35m 이상을 고소로 판정';

function settle() {
  act(() => {
    vi.advanceTimersByTime(PPE_OFF_SUSTAIN_MS);
  });
}

describe('workPpeText', () => {
  it('보호구 글: 적용 뒤 감시 중, 적용 전 준비 중, 끈 장비는 감시 대상 아님(개발 용어 없음)', () => {
    const both = { helmet: 'REQUIRED', vest: 'REQUIRED' } as const;
    const helmetOnly = { helmet: 'REQUIRED', vest: 'NOT_REQUIRED' } as const;
    const vestOnly = { helmet: 'NOT_REQUIRED', vest: 'REQUIRED' } as const;
    const none = { helmet: 'NOT_REQUIRED', vest: 'NOT_REQUIRED' } as const;
    expect(ppeStatusText(both, true)).toBe('안전모·조끼 감시 중');
    expect(ppeStatusText(helmetOnly, true)).toBe('안전모 감시 중 · 조끼 감시 대상 아님');
    expect(ppeStatusText(vestOnly, true)).toBe('조끼 감시 중 · 안전모 감시 대상 아님');
    expect(ppeStatusText(none, true)).toBe('보호구 감시 대상 아님');
    expect(ppeStatusText(both, false)).toBe(PPE_PREPARING_TEXT);
    expect(ppeStatusText(helmetOnly, false)).toBe('보호구 감시 준비 중 · 조끼 감시 대상 아님');
    expect(ppeStatusText(none, false)).toBe('보호구 감시 대상 아님');
  });

  it('적용 묶음이 이 작업의 요구면 그 값, 아니면 작업에 저장된 값(없으면 서버 기본 필수)', () => {
    const applied = readBundles([
      bundle('cfg-2', 'APPLIED', { ppe_policy: policy(12, 'REQUIRED', 'NOT_REQUIRED') }),
    ]);
    expect(activePpeRequirement(work(12), applied)).toEqual({
      helmet: 'REQUIRED',
      vest: 'NOT_REQUIRED',
    });
    // 시작 묶음 적용 전: 작업의 값
    expect(activePpeRequirement(work(13, { vest: 'NOT_REQUIRED' }), applied)).toEqual({
      helmet: 'REQUIRED',
      vest: 'NOT_REQUIRED',
    });
    expect(activePpeRequirement(work(13), undefined)).toEqual({
      helmet: 'REQUIRED',
      vest: 'REQUIRED',
    });
  });

  it('규칙 기준: 뜻이 드러나는 글, 다른 기준 묶음이 적용 대기면 덧붙인다, 모르면 null', () => {
    const classroom = bundle('cfg-1', 'APPLIED', { rule_profile: 'CLASSROOM_TEST' });
    expect(ruleProfileText(readBundles([classroom]))).toBe(CLASSROOM);
    expect(
      ruleProfileText(
        readBundles([bundle('cfg-2', 'PENDING', { rule_profile: 'OPERATION' }), classroom]),
      ),
    ).toBe(`${CLASSROOM} (바꾼 기준 적용 대기)`);
    expect(
      ruleProfileText(readBundles([bundle('cfg-1', 'APPLIED', { rule_profile: 'OPERATION' })])),
    ).toBe('운영 기준 · 높이차 2.0m 이상을 고소로 판정');
    expect(ruleProfileText(readBundles([bundle('cfg-1', 'PENDING')]))).toBeNull();
    expect(ruleProfileText(undefined)).toBeNull();
  });

  it('꺼짐 원인 글은 감시하는 장비만 이름에 넣는다', () => {
    expect(ppeOffDetail({ helmet: 'REQUIRED', vest: 'NOT_REQUIRED' })[0]).toBe(
      '보호구 상태가 들어오지 않아 안전모 미착용 경보가 나지 않습니다.',
    );
  });
});

describe('WorkPpeStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.works = { state: 'loading' };
    state.bundles = [];
    state.receipt = 'unknown';
    state.receiptEnabled = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('작업 목록을 모르거나 진행 중 작업이 없으면 그리지 않는다(작업 전은 관제 상태가 맡는다)', () => {
    const { container, rerender } = render(<WorkPpeStatus />);
    expect(container.innerHTML).toBe('');
    state.works = { state: 'ready', works: [], active: null };
    state.bundles = [bundle('cfg-1', 'APPLIED', { rule_profile: 'CLASSROOM_TEST' })];
    rerender(<WorkPpeStatus />);
    expect(container.innerHTML).toBe('');
    expect(state.receiptEnabled.every((e) => !e)).toBe(true);
  });

  it('작업 시작 직후(이번 작업 묶음 적용 전): 바로 「보호구 감시 준비 중」, 규칙 기준은 hover·자세히에만', () => {
    state.works = {
      state: 'ready',
      works: [work(12, { vest: 'NOT_REQUIRED' })],
      active: work(12, { vest: 'NOT_REQUIRED' }),
    };
    state.bundles = [
      bundle('cfg-3', 'PENDING', { ppe_policy: policy(12, 'REQUIRED', 'NOT_REQUIRED') }),
      bundle('cfg-2', 'APPLIED', {
        ppe_policy: policy(null, 'NOT_REQUIRED', 'NOT_REQUIRED'),
        rule_profile: 'CLASSROOM_TEST',
      }),
    ];
    state.receipt = 'stale';
    render(<WorkPpeStatus />);
    settle();
    expect(screen.getByRole('status').textContent).toBe(
      '보호구 감시 준비 중 · 조끼 감시 대상 아님',
    );
    const section = screen.getByRole('region', { name: '보호구 감시' });
    expect(section.textContent).not.toMatch(/0\.35m/);
    expect(section.getAttribute('title')).toBe(CLASSROOM);
    fireEvent.click(screen.getByRole('button', { name: '자세히' }));
    expect(screen.getByRole('list', { name: '보호구 감시 자세히' }).textContent).toBe(CLASSROOM);
    // 적용 전에는 PPE 수신을 보지 않는다(관제 단계가 바로 알린다, -692)
    expect(state.receiptEnabled.every((e) => !e)).toBe(true);
  });

  it('관제 중 PPE 상태가 15초 넘게 안 들어오면 같은 자리가 회색 「보호구 감시 꺼짐」 하나로 바뀌고, 원인·할 일은 자세히에 있다', () => {
    state.works = { state: 'ready', works: [work(12)], active: work(12) };
    state.bundles = [
      bundle('cfg-3', 'APPLIED', {
        ppe_policy: policy(12, 'REQUIRED', 'REQUIRED'),
        rule_profile: 'CLASSROOM_TEST',
      }),
    ];
    state.receipt = 'stale';
    render(<WorkPpeStatus />);
    expect(screen.getByRole('status').textContent).toBe('안전모·조끼 감시 중');
    settle();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(PPE_OFF_TEXT);
    expect(screen.queryByText(/감시 중/)).toBeNull();
    expect(screen.queryByText(/미착용 경보가 나지 않습니다/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '자세히' }));
    const detail = screen.getByRole('list', { name: '보호구 감시 자세히' }).textContent;
    expect(detail).toContain('안전모·조끼 미착용 경보가 나지 않습니다');
    expect(detail).toContain('현장에서 직접 확인하세요');
    expect(detail).toContain('0.35m');
  });

  it('PPE 상태가 들어오면 감시 중 그대로, 감시할 장비가 없으면 수신을 보지 않는다', () => {
    state.works = { state: 'ready', works: [work(12)], active: work(12) };
    state.bundles = [
      bundle('cfg-3', 'APPLIED', { ppe_policy: policy(12, 'REQUIRED', 'NOT_REQUIRED') }),
    ];
    state.receipt = 'ok';
    const { unmount } = render(<WorkPpeStatus />);
    settle();
    expect(screen.getByRole('status').textContent).toBe('안전모 감시 중 · 조끼 감시 대상 아님');
    expect(state.receiptEnabled.at(-1)).toBe(true);
    // 원인도 규칙 기준도 없으면 자세히 단추가 없다
    expect(screen.queryByRole('button', { name: '자세히' })).toBeNull();
    unmount();

    state.receiptEnabled = [];
    state.receipt = 'stale';
    state.bundles = [
      bundle('cfg-3', 'APPLIED', { ppe_policy: policy(12, 'NOT_REQUIRED', 'NOT_REQUIRED') }),
    ];
    render(<WorkPpeStatus />);
    settle();
    expect(screen.getByRole('status').textContent).toBe('보호구 감시 대상 아님');
    expect(state.receiptEnabled.every((e) => !e)).toBe(true);
  });
});

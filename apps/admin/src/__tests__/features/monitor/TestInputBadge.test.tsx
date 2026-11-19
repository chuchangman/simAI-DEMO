import { TestInputBadge } from '@/features/monitor/TestInputBadge';
import { useRealtimeStore } from '@/store/realtime.store';
import type { ViewerHealthPayload } from '@simai/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// S15P31A101-731: 녹화 파일 재생(시험 입력) 중 표시. 근거는 viewer_health 1.6.0 laptop.test_input 이다.

/** 계약 예시 viewer_health.test_input 과 같은 모양(laptop.test_input 만 바꾼다, 없으면 이전 EC2). */
const payload = (
  testInput: boolean | undefined,
  replayTestAlerts?: boolean,
): ViewerHealthPayload => ({
  as_of: 1_760_342_400_990,
  system_health: 'NOMINAL',
  remote_state: 'NORMAL',
  tier0_link: 'CONNECTED',
  laptop: {
    link: 'CONNECTED',
    last_heartbeat_at: 1_760_342_400_800,
    ...(testInput === undefined ? {} : { test_input: testInput }),
    ...(replayTestAlerts === undefined ? {} : { replay_test_alerts: replayTestAlerts }),
  },
  data_age_ms: 210,
  calibration_state: 'CALIBRATED',
  config: { published_version: 'cfg-12', applied_version: 'cfg-12', sync: 'CURRENT' },
  scene: { committed_version: 'scene-3', live_version: 'scene-3', mismatch: false },
  tier0_health: null,
});

const setHealth = (testInput: boolean | undefined, replayTestAlerts?: boolean) =>
  act(() =>
    useRealtimeStore.setState({
      health: { payload: payload(testInput, replayTestAlerts), receivedAt: 0, clockOffsetMs: 0 },
    }),
  );

afterEach(() => {
  cleanup();
  useRealtimeStore.setState({ health: null });
});

describe('TestInputBadge', () => {
  it('재생 중이면 「녹화 재생 중 · 실제 알림 꺼짐」과 설명을 보인다', () => {
    setHealth(true);
    render(<TestInputBadge />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('녹화 재생 중 · 실제 알림 꺼짐');
    expect(badge.getAttribute('title')).toContain('현장 경보 소리·워치 진동은 보내지 않습니다');
  });

  it('재생 시험 알림 스위치가 켜져 있으면 「재생 시험 · 실제 알림 켜짐」을 크게 보인다(S15P31A101-736)', () => {
    setHealth(true, true);
    render(<TestInputBadge />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('재생 시험 · 실제 알림 켜짐');
    expect(badge.hasAttribute('data-replay-test-alerts')).toBe(true);
    expect(badge.getAttribute('title')).toContain('SIMAI_REPLAY_TEST_ALERTS');
  });

  it('스위치가 꺼졌거나 모르면 지금처럼 「실제 알림 꺼짐」이고, 실제 카메라면 스위치와 무관하게 그리지 않는다', () => {
    setHealth(true, false);
    const view = render(<TestInputBadge />);
    expect(screen.getByRole('status').textContent).toBe('녹화 재생 중 · 실제 알림 꺼짐');
    setHealth(false, true);
    view.rerender(<TestInputBadge />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('실제 카메라이거나 모르면(이전 EC2·health 없음) 그리지 않는다', () => {
    setHealth(false);
    const view = render(<TestInputBadge />);
    expect(screen.queryByRole('status')).toBeNull();
    setHealth(undefined);
    view.rerender(<TestInputBadge />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => useRealtimeStore.setState({ health: null }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

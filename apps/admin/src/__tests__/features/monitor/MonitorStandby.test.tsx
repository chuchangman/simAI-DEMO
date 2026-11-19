import { MonitorStandby } from '@/features/monitor/MonitorStandby';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ gpuOff: false }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/features/monitor/useTodayWorks', () => ({
  useTodayWorks: () => ({ state: 'ready', standby: 'setup' }),
}));
vi.mock('@/features/gpu/useGpu', () => ({ useGpuKnownOff: () => state.gpuOff }));
vi.mock('@/features/gpu/GpuPanel', () => ({
  GpuPanel: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="GPU 패널">
      <button onClick={onClose}>닫기</button>
    </div>
  ),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

describe('MonitorStandby GPU 꺼짐(-752)', () => {
  beforeEach(() => {
    state.gpuOff = false;
    navigate.mockReset();
  });
  afterEach(cleanup);

  it('GPU 꺼짐이면 첫 줄이 「GPU 꺼짐」이고 주 행동은 「GPU 켜기」(패널 열기)이며 남은 일은 아랫줄에 둔다', () => {
    state.gpuOff = true;
    render(<MonitorStandby />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('GPU 꺼짐');
    expect(screen.getByText(/오늘 세팅이 끝나지 않았습니다/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'GPU 켜기' }));
    expect(screen.getByRole('dialog', { name: 'GPU 패널' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '작업 관리로' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/work' });
  });

  it('GPU 꺼짐을 모르면 기존 대기 화면 그대로다(꺼짐을 지어내지 않음)', () => {
    render(<MonitorStandby />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      '오늘 세팅이 끝나지 않았습니다',
    );
    expect(screen.queryByRole('button', { name: 'GPU 켜기' })).toBeNull();
  });
});

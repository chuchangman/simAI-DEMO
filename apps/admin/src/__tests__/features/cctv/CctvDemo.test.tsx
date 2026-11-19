import { CctvDemo } from '@/features/cctv/CctvDemo';
import { worldStateAt } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
  useRealtimeStore.setState({ world: null });
});

describe('CCTV 실시간 목 화면', () => {
  it('지금 World 의 사람을 카메라 네 대에 그리고, 칸을 누르면 그 칸을 크게 본다', () => {
    const now = Date.now();
    useRealtimeStore.setState({ world: { payload: worldStateAt(now).payload, receivedAt: now } });
    render(<CctvDemo />);

    const feeds = screen.getAllByRole('img', { name: /카메라 \d 영상/ });
    expect(feeds).toHaveLength(4);
    expect(
      feeds.reduce((n, feed) => n + feed.querySelectorAll('circle').length, 0),
    ).toBeGreaterThan(0);

    act(() => screen.getByRole('button', { name: '카메라 2 크게 보기' }).click());
    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4분할로 돌아가기' })).toBeTruthy();
  });
});

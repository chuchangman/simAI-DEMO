import { requestVideoSegments } from '@/features/history/api';
import { useReplaySegments } from '@/features/history/useReplaySegments';
import { ApiError } from '@/lib/http';
import { useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/features/history/api', () => ({ requestVideoSegments: vi.fn() }));
const request = vi.mocked(requestVideoSegments);
const range = { from: 1000, to: 2000 };
const pending = {
  schema_version: '1.0.0',
  work_id: 1,
  status: 'UPLOADING',
  expected_segments: 1,
  uploaded_segments: 0,
  failed_segments: 0,
} as const;
const segment = {
  segment_id: 'new',
  camera_id: 'cam_A',
  segment_start_capture_ms: 1000,
  segment_end_capture_ms: 2000,
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReplaySegments(range), { wrapper });
}
async function tick(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  useSessionStore.setState({
    session: { accessToken: 'test', user: { id: 'admin', role: 'ADMIN' } },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

describe('종료 작업 영상 자동 갱신', () => {
  it('빈 목록을 열어 둔 상태에서 완료된 영상을 자동 반영하고 폴링을 멈춘다', async () => {
    request.mockResolvedValueOnce({ segments: [], recording_uploads: [pending] });
    request.mockResolvedValue({
      segments: [segment],
      recording_uploads: [{ ...pending, status: 'COMPLETED', uploaded_segments: 1 }],
    });
    const hook = mount();
    await tick();
    expect(hook.result.current.message).toBe('영상 업로드 중 · 3D 기록 먼저 보기');
    expect(hook.result.current.segments).toHaveLength(0);
    await tick(10_001);
    expect(hook.result.current.segments).toEqual([segment]);
    expect(hook.result.current.message).toBeNull();
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('완료 보고가 없어도 10분 뒤에는 자동 조회를 멈춘다', async () => {
    request.mockResolvedValue({ segments: [], recording_uploads: [pending] });
    mount();
    await tick(610_000);
    const count = request.mock.calls.length;
    expect(count).toBeLessThanOrEqual(60);
    expect(count).toBeGreaterThan(1);
    await tick(60_000);
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('권한이 바뀌면 이전 관리자 캐시의 영상도 숨긴다', async () => {
    request.mockResolvedValue({
      segments: [segment],
      recording_uploads: [{ ...pending, status: 'COMPLETED', uploaded_segments: 1 }],
    });
    const hook = mount();
    await tick();
    expect(hook.result.current.segments).toHaveLength(1);
    act(() =>
      useSessionStore.setState({
        session: { accessToken: 'other', user: { id: 'v', role: 'VIEWER' } },
      }),
    );
    expect(hook.result.current.segments).toHaveLength(0);
  });
  it('권한 없는 계정은 자동 조회를 하지 않는다', async () => {
    useSessionStore.setState({
      session: { accessToken: 'test', user: { id: 'viewer', role: 'VIEWER' } },
    });
    const hook = mount();
    await tick(30_000);
    expect(request).not.toHaveBeenCalled();
    expect(hook.result.current.message).toContain('권한');
    expect(hook.result.current.canRefresh).toBe(false);
  });
  it.each([
    ['NO_RECORDING', '녹화된 영상이 없습니다'],
    ['EXPIRED', '보관 기간이 만료'],
    ['FAILED', '업로드에 실패'],
  ] as const)('%s 상태를 구분한다', async (status, message) => {
    request.mockResolvedValue({ segments: [], recording_uploads: [{ ...pending, status }] });
    const hook = mount();
    await tick();
    expect(hook.result.current.message).toContain(message);
  });
  it('403은 권한 안내를 보이고 반복 요청하지 않는다', async () => {
    request.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN' }));
    const hook = mount();
    await tick(30_000);
    expect(hook.result.current.message).toContain('권한');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('통신 실패를 녹화 없음으로 보이지 않고 다음 조회에서 회복한다', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    request.mockResolvedValue({ segments: [], recording_uploads: [pending] });
    const hook = mount();
    await tick();
    expect(hook.result.current.message).toContain('네트워크');
    await tick(10_001);
    expect(hook.result.current.message).toContain('영상 업로드 중');
  });
  it('오래된 작업(종료 후 10분 경과)에 보고 없는 WAITING 만 있으면 업로드 중으로 두지 않고 녹화 없음 사유를 보인다', async () => {
    request.mockResolvedValue({
      segments: [],
      recording_uploads: [{ ...pending, status: 'WAITING', expected_segments: null }],
    });
    const hook = mount();
    await tick();
    expect(hook.result.current.message).toBe(
      '이 작업 구간에 업로드된 녹화 영상이 없습니다(현장 노트북 미연결 또는 녹화 없음).',
    );
    await tick(30_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

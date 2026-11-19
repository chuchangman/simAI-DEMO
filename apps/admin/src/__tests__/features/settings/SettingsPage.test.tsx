import { useThemeStore } from '@/features/layout/theme.store';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { alarmSound } from '@/lib/alarmSound';
import { useSessionStore, type Role } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const settingsRequests: string[] = [];
const server = setupServer(
  http.get('*/api/gpu/settings', () => {
    settingsRequests.push('get');
    return HttpResponse.json({
      settings: {
        version_id: 2,
        provider: 'RUNPOD',
        preferred_gpu_types: ['NVIDIA H100 80GB HBM3'],
        preferred_regions: ['AP-JP-1'],
        cloud_type: 'SECURE',
        interruptible: false,
        max_price_per_hour_usd: null,
        auto_stop_idle_minutes: 30,
        runpod_template_id: 'tpl-simai',
        created_at_ms: 1_793_000_000_000,
      },
      providers: [{ id: 'RUNPOD', configured: true }],
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  settingsRequests.length = 0;
  useSessionStore.getState().signOut();
  useThemeStore.setState({ theme: 'dark' });
  alarmSound.setMuted(false);
});

function signInAs(role: Role) {
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u-1', role } });
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsPage />
    </QueryClientProvider>,
  );
}

const sections = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('SettingsPage (S15P31A101-705)', () => {
  it.each([
    ['ADMIN', ['화면', '경보 소리', 'GPU']],
    ['FOREMAN', ['화면', '경보 소리']],
    ['VIEWER', ['화면']],
  ] as const)('%s 는 쓸 수 있는 구역만 본다', async (role, expected) => {
    signInAs(role);
    renderPage();
    if (role === 'ADMIN') await screen.findByLabelText('선호 GPU (위가 먼저)');
    expect(sections()).toEqual(expected);
    // GPU 설정은 관리자만 서버에 묻는다
    expect(settingsRequests.length > 0).toBe(role === 'ADMIN');
  });

  it('화면 모드를 바꾸면 테마 저장소가 바뀐다(옛 계정 메뉴의 화이트·다크 모드)', () => {
    signInAs('VIEWER');
    renderPage();
    expect((screen.getByLabelText('다크 모드') as HTMLInputElement).checked).toBe(true);
    act(() => fireEvent.click(screen.getByLabelText('화이트 모드')));
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => fireEvent.click(screen.getByLabelText('다크 모드')));
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('경보 소리는 상단바 소리 버튼과 같은 값을 켜고 끈다', () => {
    signInAs('FOREMAN');
    renderPage();
    const box = screen.getByLabelText('확인 대기 경보를 소리로 알리기') as HTMLInputElement;
    expect(box.checked).toBe(true);
    act(() => fireEvent.click(box));
    expect(alarmSound.getSnapshot().muted).toBe(true);
    expect(box.checked).toBe(false);
  });

  it('GPU 구역은 설정 페이지 안에 바로 보인다(창이 아님)', async () => {
    signInAs('ADMIN');
    renderPage();
    await screen.findByLabelText('선호 GPU (위가 먼저)');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('버전 2')).toBeTruthy();
  });
});

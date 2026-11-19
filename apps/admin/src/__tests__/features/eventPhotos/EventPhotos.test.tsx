import { EventPhotos } from '@/features/eventPhotos/EventPhotos';
import { PhotosPanel } from '@/features/events/EventDetailPanels';
import type { EventItem } from '@/features/events/types';
import { type Role, useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const T = 1_760_342_400_000;

const event = (change: Partial<EventItem> = {}): EventItem => ({
  event_id: 'e-1',
  rule_id: 'R1',
  source: 'LIVE',
  lifecycle: 'RAISED',
  verification: 'VERIFIED',
  severity: 'CRITICAL',
  confidence: 'HIGH',
  needs_check: false,
  world_ids: ['w-0012'],
  zone_id: 'z-02',
  metrics: {},
  rationale: null,
  proposed_severity: null,
  raised_at: T,
  updated_at: T,
  ...change,
});

let frames: unknown[] = [];
let calls = 0;
let status = 200;

const photo = (camera: string, n = 1) => ({
  camera_id: camera,
  capture_ms: T,
  timestamp_source: 'RECEIVE_ESTIMATED',
  url: `http://storage.test/event-frames/e-1/${camera}-${n}.jpg`,
  expires_at_ms: Date.now() + 300_000,
});

const server = setupServer(
  http.get('http://api.test/api/events/:id/frames', ({ params }) => {
    calls += 1;
    if (status !== 200) return HttpResponse.json({ code: 'X' }, { status });
    return HttpResponse.json({ event_id: params.id, frames });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  frames = [photo('cam_A'), photo('cam_B'), { broken: true }];
  calls = 0;
  status = 200;
  signIn('ADMIN');
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.setState(useSessionStore.getInitialState(), true);
});

function signIn(role: Role) {
  useSessionStore.getState().signIn({ accessToken: 't', user: { id: 'u', role } });
}

function renderWith(node: React.ReactNode) {
  const queryClient = new QueryClient();
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('EventPhotos', () => {
  it('관리자에게 카메라별 썸네일을 보이고(형식이 틀린 항목은 뺀다) 누르면 크게 본다', async () => {
    renderWith(<EventPhotos event={event()} />);

    const section = await screen.findByRole('region', { name: '사진 사진' });
    expect(section).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /카메라 1 .* 사진 크게 보기/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(
      'http://storage.test/event-frames/e-1/cam_A-1.jpg',
    );
    // Esc 로 사진 창만 닫힌다.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('사진이 깨져 보이면(주소 만료) 목록을 다시 받아 새 주소로 바꾼다', async () => {
    renderWith(<EventPhotos event={event()} />);
    const first = (await screen.findAllByRole('img'))[0]!;
    expect(first.getAttribute('src')).toContain('cam_A-1.jpg');

    frames = [photo('cam_A', 2), photo('cam_B', 2)];
    fireEvent.error(first);
    await waitFor(() =>
      expect(screen.getAllByRole('img')[0]!.getAttribute('src')).toContain('cam_A-2.jpg'),
    );
    expect(calls).toBe(2);
  });

  it('사진이 없거나 받지 못하거나 관리자·위험 이벤트가 아니면 칸을 그리지 않고 받지도 않는다', async () => {
    frames = [];
    renderWith(<PhotosPanel entries={[{ event: event() } as never]} />);
    await waitFor(() => expect(calls).toBe(1));
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('[data-photos]')).toBeNull();
    cleanup();

    status = 403;
    renderWith(<EventPhotos event={event()} />);
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByRole('region')).toBeNull();
    cleanup();

    status = 200;
    renderWith(<EventPhotos event={event({ severity: 'HIGH' })} />);
    cleanup();
    signIn('FOREMAN');
    renderWith(<EventPhotos event={event()} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('region')).toBeNull();
    expect(calls).toBe(2);
  });
});

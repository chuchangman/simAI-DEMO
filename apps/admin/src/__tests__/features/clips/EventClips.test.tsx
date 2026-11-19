import { EventClips } from '@/features/clips/EventClips';
import type { Clip } from '@/features/clips/types';
import { clipsKey } from '@/features/clips/useEventClips';
import { EventDetail } from '@/features/events/EventDetail';
import { formatTime, groupIncidents } from '@/features/events/events';
import type { EventItem } from '@/features/events/types';
import { buildTestH264Stream } from '@/mocks/h264TestStream';
import { type Role, useSessionStore } from '@/store/session.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const T = 1_760_342_400_000;

const clip = (change: Partial<Clip> = {}): Clip => ({
  clip_id: 'c-1',
  camera_id: 'cam_A',
  resume_count: 0,
  clip_start_capture_ms: T - 20_000,
  clip_end_capture_ms: T + 20_000,
  frame_count: 600,
  truncated_start: false,
  truncated_end: false,
  has_gaps: false,
  content_type: 'video/h264',
  container: 'h264-annexb',
  size_bytes: 1_200_000,
  retention_hold: false,
  auto_retained: false,
  delete_after_ms: T + 14 * 24 * 60 * 60 * 1000,
  deleted_at_ms: null,
  ...change,
});

const event = (change: Partial<EventItem> = {}): EventItem => ({
  event_id: 'e-1',
  rule_id: 'R1',
  source: 'LIVE',
  lifecycle: 'RAISED',
  verification: 'VERIFIED',
  severity: 'HIGH',
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

let clips: Clip[] = [];
let listCalls = 0;
let urlCalls = 0;
let puts: unknown[] = [];
let urlExpiresIn = 60_000;
/** 재생 주소 응답의 형식. 기본은 그대로 재생하는 mp4 다. */
let urlFormat: { content_type: string; container: string } = {
  content_type: 'video/mp4',
  container: 'mp4',
};
/** 저장소(서명 주소)가 주는 바이트와 상태. */
let storageBody: Uint8Array = new Uint8Array();
let storageStatus = 200;
let storageAuthorization: string | null | undefined;
/** 정해 두면 서버가 그때까지 답하지 않는다(답하기 전 화면을 본다). */
let urlGate: Promise<void> | undefined;
let putGate: Promise<void> | undefined;

/** 붙잡아 둔 답을 풀어 주는 함수와 함께 문을 만든다. */
function gate() {
  let open = () => {};
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { closed, open };
}

const server = setupServer(
  http.get('http://api.test/api/events/:id/clips', ({ params }) => {
    listCalls += 1;
    return HttpResponse.json({ event_id: params.id, clips });
  }),
  http.get('http://api.test/api/clips/:id', async ({ params }) => {
    const n = ++urlCalls;
    await urlGate;
    return HttpResponse.json({
      clip_id: params.id,
      url:
        urlFormat.container === 'mp4'
          ? `/clips/${String(params.id)}-${n}.mp4`
          : `http://storage.test/clips/${String(params.id)}.h264`,
      expires_at_ms: Date.now() + urlExpiresIn,
      ...urlFormat,
    });
  }),
  http.get('http://storage.test/clips/:name', ({ request }) => {
    storageAuthorization = request.headers.get('Authorization');
    return new HttpResponse(storageStatus === 200 ? (storageBody as BodyInit) : null, {
      status: storageStatus,
    });
  }),
  http.put('http://api.test/api/clips/:id/retention', async ({ params, request }) => {
    const body = (await request.json()) as { retention_hold: boolean };
    puts.push(body);
    await putGate;
    clips = clips.map((c) =>
      c.clip_id === params.id ? { ...c, retention_hold: body.retention_hold } : c,
    );
    return HttpResponse.json(clips.find((c) => c.clip_id === params.id));
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  clips = [
    clip(),
    clip({ clip_id: 'c-2', camera_id: 'cam_B', truncated_start: true }),
    clip({ clip_id: 'c-3', camera_id: 'cam_C', has_gaps: true }),
  ];
  listCalls = 0;
  urlCalls = 0;
  puts = [];
  urlExpiresIn = 60_000;
  urlFormat = { content_type: 'video/mp4', container: 'mp4' };
  storageBody = new Uint8Array();
  storageStatus = 200;
  storageAuthorization = undefined;
  urlGate = undefined;
  putGate = undefined;
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

function renderClips(item = event()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <EventClips event={item} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];
const cameraName = (id: string) => `카메라 ${CAMS.indexOf(id) + 1}`;

const playButton = (camera: string) =>
  screen.getByRole('button', { name: `${cameraName(camera)} 재생` });
const closeButton = (camera: string) =>
  screen.getByRole('button', { name: `${cameraName(camera)} 닫기` });
const video = (camera: string) =>
  screen.getByLabelText(`${cameraName(camera)} 클립`) as HTMLVideoElement;

describe('EventClips', () => {
  it('관리자에게 카메라별 클립과 잘림·빈칸을 보이고, 재생을 누르기 전에는 주소를 받지 않는다', async () => {
    renderClips();

    const section = await screen.findByRole('region', { name: '클립' });
    expect(await within(section).findByText('카메라 1')).toBeTruthy();
    expect(within(section).getByText('카메라 2')).toBeTruthy();
    expect(within(section).getByText('앞 잘림')).toBeTruthy();
    expect(within(section).getByText('프레임 빠짐')).toBeTruthy();
    // 촬영 구간은 시작 ~ 끝 순서다.
    const range = `${formatTime(T - 20_000)} ~ ${formatTime(T + 20_000)}`;
    expect(within(section).getAllByText(range)).toHaveLength(3);
    // 영상 주소를 받을 때 EC2 가 조회 기록을 남긴다. 상세를 열기만 해서는 받지 않는다.
    expect(urlCalls).toBe(0);
    expect(screen.queryByLabelText('카메라 1 클립')).toBeNull();
  });

  it('재생을 누르면 주소를 받아 영상을 보이고 버튼이 닫기로 바뀌며, 닫았다 다시 재생해도 살아 있는 주소는 또 받지 않는다', async () => {
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4'));
    expect(urlCalls).toBe(1);
    // 브라우저 기본 메뉴의 내려받기를 감추고 우클릭 메뉴를 막는다.
    expect(video('cam_A').getAttribute('controlslist')).toBe('nodownload');
    expect(fireEvent.contextMenu(video('cam_A'))).toBe(false);
    // 영상이 열려 있는 동안 재생 버튼은 닫기다.
    expect(screen.queryByRole('button', { name: '카메라 1 재생' })).toBeNull();

    fireEvent.click(closeButton('cam_A'));
    expect(screen.queryByLabelText('카메라 1 클립')).toBeNull();
    expect(playButton('cam_A')).toBeTruthy();

    // 다시 재생하면 영상을 새로 띄워 처음부터 튼다. 요청을 보냈다면 이 사이에 도착한다.
    fireEvent.click(playButton('cam_A'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(urlCalls).toBe(1);
    expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4');
  });

  it('주소를 받는 동안에는 닫기가 보이고, 받은 뒤에도 주소를 또 받지 않는다', async () => {
    const answer = gate();
    urlGate = answer.closed;
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(urlCalls).toBe(1));
    expect(closeButton('cam_A')).toBeTruthy();
    answer.open();

    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(urlCalls).toBe(1);
  });

  it('주소가 만료됐으면 닫았다 다시 재생할 때 새 주소를 받는다', async () => {
    urlExpiresIn = 1_000;
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(urlCalls).toBe(1));
    fireEvent.click(closeButton('cam_A'));
    fireEvent.click(playButton('cam_A'));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-2.mp4'));
  });

  it('재생이 실패하면 한 번만 새 주소를 받고, 또 실패하면 알린다', async () => {
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4'));
    fireEvent.error(video('cam_A'));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-2.mp4'));
    fireEvent.error(video('cam_A'));

    expect(await screen.findByText('재생하지 못했습니다')).toBeTruthy();
    expect(screen.queryByLabelText('카메라 1 클립')).toBeNull();
    expect(urlCalls).toBe(2);
  });

  it('주소를 받은 지 오래된 뒤 재생이 실패하면(되감기 중 만료) 다시 받는다', async () => {
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4'));
    fireEvent.error(video('cam_A'));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-2.mp4'));

    const realNow = Date.now.bind(Date);
    const later = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 31_000);
    try {
      fireEvent.error(video('cam_A'));
      await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-3.mp4'));
      expect(screen.queryByText('재생하지 못했습니다')).toBeNull();
    } finally {
      later.mockRestore();
    }
  });

  it('재생 주소를 받지 못하면 알린다', async () => {
    server.use(
      http.get('http://api.test/api/clips/:id', () => HttpResponse.json({}, { status: 500 })),
    );
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    expect((await screen.findByRole('alert')).textContent).toBe('재생 주소를 받지 못했습니다');
  });

  it('지운 클립은 삭제됨과 지운 시각이 보이고 재생·보존 버튼이 없다', async () => {
    clips = [clip({ deleted_at_ms: T })];
    renderClips();

    expect(await screen.findByText(/^삭제됨 · /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '카메라 1 재생' })).toBeNull();
    expect(screen.queryByRole('button', { name: '카메라 1 보존' })).toBeNull();
  });

  it('목록을 받은 뒤 지워진 클립을 재생하면(410 CLIP_DELETED) 알리고 목록을 다시 받아 삭제됨으로 그린다', async () => {
    server.use(
      http.get('http://api.test/api/clips/:id', () => {
        // 서버가 그사이 지웠다: 목록도 이제 지운 시각을 준다.
        clips = clips.map((c) => (c.clip_id === 'c-1' ? { ...c, deleted_at_ms: T } : c));
        return HttpResponse.json({ status: 410, code: 'CLIP_DELETED' }, { status: 410 });
      }),
    );
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    expect(await screen.findByText(/^삭제됨 · /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '카메라 1 재생' })).toBeNull();
  });

  describe('h264-annexb 클립(서버는 변환하지 않는다)', () => {
    const created: Blob[] = [];
    const revoked: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    });
    const revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

    beforeEach(() => {
      created.length = 0;
      revoked.length = 0;
      createObjectURL.mockClear();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      urlFormat = { content_type: 'video/h264', container: 'h264-annexb' };
      storageBody = buildTestH264Stream({ frames: 30 }).data;
    });
    afterEach(() => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    });

    it('저장소에서 받아 MP4 로 감싼 blob 으로 재생하고, 서명 주소에는 Authorization 을 싣지 않는다', async () => {
      renderClips();

      fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
      await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('blob:test/1'));
      expect(storageAuthorization).toBeNull();
      const blob = created[0]!;
      expect(blob.type).toBe('video/mp4');
      // 감싼 MP4: 처음 상자가 ftyp 다.
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      expect(new TextDecoder().decode(head.subarray(4, 8))).toBe('ftyp');
      expect(urlCalls).toBe(1);
    });

    it('감싼 영상은 만료가 없어 닫았다 다시 재생해도 주소를 또 받지 않고, 화면을 닫으면 blob 을 해제한다', async () => {
      urlExpiresIn = 1_000;
      renderClips();

      fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
      await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('blob:test/1'));
      await act(() => new Promise((resolve) => setTimeout(resolve, 1_200)));
      fireEvent.click(closeButton('cam_A'));
      fireEvent.click(playButton('cam_A'));
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
      expect(urlCalls).toBe(1);
      expect(video('cam_A').getAttribute('src')).toBe('blob:test/1');

      expect(revoked).toEqual([]);
      cleanup();
      expect(revoked).toEqual(['blob:test/1']);
    });

    it('저장소에서 받지 못하면 알린다', async () => {
      storageStatus = 403;
      renderClips();

      fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
      expect((await screen.findByRole('alert')).textContent).toBe('영상을 받지 못했습니다');
      expect(screen.queryByLabelText('카메라 1 클립')).toBeNull();
    });

    it('H.264 로 읽히지 않는 바이트면 알린다', async () => {
      storageBody = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      renderClips();

      fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
      expect((await screen.findByRole('alert')).textContent).toBe('영상 형식을 읽지 못했습니다');
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('모르는 container 면 받지 않고 알린다', async () => {
      urlFormat = { content_type: 'video/x-matroska', container: 'mkv' };
      renderClips();

      fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
      expect((await screen.findByRole('alert')).textContent).toBe('지원하지 않는 영상 형식입니다');
      expect(storageAuthorization).toBeUndefined();
    });
  });

  const holdButton = () => screen.getByRole('button', { name: '카메라 1 보존' });

  it('HIGH 이벤트 클립은 관리자가 보존 표시를 붙이고 떼며, 서버 값으로 다시 그린다', async () => {
    renderClips();

    await screen.findByRole('button', { name: '카메라 1 보존' });
    expect(holdButton().getAttribute('aria-pressed')).toBe('false');
    const before = listCalls;
    fireEvent.click(holdButton());
    await waitFor(() => expect(holdButton().getAttribute('aria-pressed')).toBe('true'));
    expect(listCalls).toBeGreaterThan(before);

    fireEvent.click(holdButton());
    await waitFor(() => expect(holdButton().getAttribute('aria-pressed')).toBe('false'));
    expect(puts).toEqual([{ retention_hold: true }, { retention_hold: false }]);
  });

  it('보존 표시는 서버가 답하기 전에는 바꿔 그리지 않는다(낙관적 갱신 없음)', async () => {
    const answer = gate();
    putGate = answer.closed;
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 보존' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(holdButton().getAttribute('aria-pressed')).toBe('false');

    answer.open();
    await waitFor(() => expect(holdButton().getAttribute('aria-pressed')).toBe('true'));
  });

  it('자동 보존 클립은 자동 보존 표시만 있고 바꾸는 버튼이 없다', async () => {
    clips = [clip({ retention_hold: true, auto_retained: true })];
    renderClips(event({ severity: 'CRITICAL' }));

    const section = await screen.findByRole('region', { name: '클립' });
    expect(await within(section).findByText('자동 보존')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '카메라 1 보존' })).toBeNull();
  });

  it('CRITICAL 이벤트라도 서버가 자동 보존이라 하지 않은 클립(표시 꺼짐)은 보존 버튼이 있다', async () => {
    clips = [clip({ retention_hold: false, auto_retained: false })];
    renderClips(event({ severity: 'CRITICAL' }));

    expect(await screen.findByRole('button', { name: '카메라 1 보존' })).toBeTruthy();
    expect(screen.queryByText('자동 보존')).toBeNull();
  });

  it('관리자가 붙인 보존 표시는 보존 버튼이 눌린 채로 보이고 자동 보존 글자는 없다', async () => {
    clips = [clip({ retention_hold: true, auto_retained: false })];
    renderClips();

    const button = await screen.findByRole('button', { name: '카메라 1 보존' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('자동 보존')).toBeNull();
  });

  it('자동 보존을 떼려다 서버가 거절하면(409 CLIP_AUTO_RETAINED) 이유를 알린다', async () => {
    server.use(
      http.put('http://api.test/api/clips/:id/retention', () =>
        HttpResponse.json({ status: 409, code: 'CLIP_AUTO_RETAINED' }, { status: 409 }),
      ),
    );
    clips = [clip({ retention_hold: true })];
    renderClips();

    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 보존' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '자동 보존 클립은 보존 표시를 뗄 수 없습니다',
    );
  });

  it('재개 구간이 있으면 발생·재개로 묶는다', async () => {
    clips = [clip(), clip({ clip_id: 'c-9', resume_count: 1 })];
    renderClips();

    expect(await screen.findByText('발생')).toBeTruthy();
    expect(screen.getByText('재개 1')).toBeTruthy();
  });

  it('클립이 아직 없으면 비우고, 목록을 받지 못하면 알린다', async () => {
    clips = [];
    renderClips();
    const section = await screen.findByRole('region', { name: '클립' });
    await waitFor(() => expect(listCalls).toBe(1));
    expect(within(section).getByText(/영상을 받지 못했습니다/)).toBeTruthy();
    cleanup();

    server.use(
      http.get('http://api.test/api/events/:id/clips', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    renderClips();
    expect(await screen.findByText('클립 목록을 받지 못했습니다')).toBeTruthy();
  });

  it('방금 난 이벤트에 클립이 아직 없으면 영상 준비 중이고, 올라오면 클립으로 바뀐다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      clips = [];
      const now = Date.now();
      renderClips(event({ raised_at: now, updated_at: now }));
      const section = await screen.findByRole('region', { name: '클립' });
      await waitFor(() => expect(listCalls).toBe(1));
      expect(within(section).getByText('영상 준비 중')).toBeTruthy();
      expect(within(section).queryByText('—')).toBeNull();

      clips = [clip()];
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(await within(section).findByText('카메라 1')).toBeTruthy();
      expect(within(section).queryByText('영상 준비 중')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('목록을 다시 받지 못해도 받아 둔 클립과 보던 영상은 그대로 두고 실패를 알린다', async () => {
    const queryClient = renderClips();
    fireEvent.click(await screen.findByRole('button', { name: '카메라 1 재생' }));
    await waitFor(() => expect(video('cam_A').getAttribute('src')).toBe('/clips/c-1-1.mp4'));
    const playing = video('cam_A');

    server.use(
      http.get('http://api.test/api/events/:id/clips', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    await act(() => queryClient.refetchQueries({ queryKey: clipsKey('e-1') }));

    expect(await screen.findByText('클립 목록을 받지 못했습니다')).toBeTruthy();
    expect(video('cam_A')).toBe(playing);
    expect(screen.getByText('카메라 3')).toBeTruthy();
  });

  it('상세를 보는 동안 다시 받아 늦게 올라온 클립을 보인다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      clips = [];
      renderClips();
      await waitFor(() => expect(listCalls).toBe(1));
      expect(screen.queryByText('카메라 1')).toBeNull();

      clips = [clip()];
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(await screen.findByText('카메라 1')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['목록이 404(주소 없음)이면 다시 받지 않는다', () => HttpResponse.json({}, { status: 404 }), 1],
    ['목록 형식이 다르면 다시 받지 않는다', () => HttpResponse.json({ clips: [] }), 1],
    ['목록이 500(서버 오류)이면 계속 다시 받는다', () => HttpResponse.json({}, { status: 500 }), 3],
  ] as const)('%s', async (_, reply, calls) => {
    let n = 0;
    server.use(
      http.get('http://api.test/api/events/:id/clips', () => {
        n += 1;
        return reply();
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderClips();
      expect(await screen.findByText('클립 목록을 받지 못했습니다')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      expect(n).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['FOREMAN', event()],
    ['VIEWER', event()],
    ['ADMIN', event({ severity: 'CAUTION' })],
    ['ADMIN', event({ source: 'PLANNED' })],
  ] as const)('%s 이거나 클립이 없는 이벤트면 그리지 않고 목록도 부르지 않는다', (role, item) => {
    act(() => signIn(role));
    const queryClient = renderClips(item);

    expect(screen.queryByRole('region', { name: '클립' })).toBeNull();
    // 꺼 둔 조회는 시간이 지나도 요청하지 않는다. 기다리지 않고 꺼져 있는지를 본다.
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: clipsKey(item.event_id) })
        ?.isDisabled(),
    ).toBe(true);
    expect(listCalls).toBe(0);
  });

  it('사건 상세 창의 이벤트 클립 칸에 규칙별 클립이 들어간다', async () => {
    const item = event();
    const [incident] = groupIncidents([{ event: item, stageStartedAt: T }]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EventDetail incident={incident!} openEventId={item.event_id} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const detail = screen.getByRole('region', { name: '이벤트 클립' });
    expect(await within(detail).findByRole('button', { name: '카메라 1 재생' })).toBeTruthy();
  });
});

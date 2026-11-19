import { useCctvStore } from '@/features/cctv/cctv.store';
import { CctvPage } from '@/features/cctv/CctvPage';
import {
  IDENTITY_VIEW,
  panBy,
  panZoomTransform,
  visibleRect,
  wheelFactor,
  zoomAt,
} from '@/features/cctv/panZoom';
import { useCctvPreview } from '@/features/cctv/useCctvPreview';
import { DRAG_THRESHOLD_PX } from '@/hooks/useFloatSpot';
import { viewerHealthAt } from '@/mocks/realtimeScenario';
import { useRealtimeStore } from '@/store/realtime.store';
import { useSessionStore, type Role } from '@/store/session.store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 현장 노트북 중계(WebSocket·WebCodecs)는 붙이지 않는다. 연결·카메라 단계는 cctv.store 에 직접 넣는다.
vi.mock('@/lib/env', () => ({
  env: { VITE_CCTV_PREVIEW_URL: 'ws://127.0.0.1:47032', VITE_STOMP_URL: 'wss://simai.live/ws' },
}));
const resume = vi.fn();
vi.mock('@/features/cctv/useCctvPreview', () => ({
  useCctvPreview: vi.fn(() => ({ attach: vi.fn(), resume })),
}));

// T 는 mock 바퀴(40초)의 0초라 카메라 4대가 정상이다. T + 20초부터 6초 동안 cam_C 가 키프레임을 기다린다.
const T = 1_760_342_400_000;
const CAMS = ['cam_A', 'cam_B', 'cam_C', 'cam_D'];

const cameraName = (id: string) => `카메라 ${CAMS.indexOf(id) + 1}`;

function signIn(role: Role) {
  useSessionStore.setState({ session: { accessToken: 'token', user: { id: role, role } } });
}

/** 지금 막 받은 health(카메라 4대)와 world 를 넣는다. 둘 다 최근이라 EC2 와 이어져 있고 World 도 들어온다. */
function seedRealtime({
  at = T,
  tier0 = 'CONNECTED' as 'CONNECTED' | 'DISCONNECTED',
  world = true,
} = {}) {
  const now = Date.now();
  useRealtimeStore.setState({
    phase: 'OPEN',
    openedAt: now,
    health: {
      payload: { ...viewerHealthAt(at).payload, as_of: now, tier0_link: tier0 },
      receivedAt: now,
      clockOffsetMs: 0,
    },
    world: world ? { payload: { tracks: [] } as never, receivedAt: now } : null,
  });
}

/** 중계가 열려 카메라 4대를 알렸고 cam_A 만 영상을 그리는 중이다. */
function openRelay() {
  const store = useCctvStore.getState();
  store.setLink('open');
  store.hello(CAMS);
  store.codec('cam_A', 2304, 1296);
  store.played('cam_A', Date.now(), Date.now());
}

/** 칸 오른쪽 위 판정 지연 배지(S15P31A101-704). 없으면 null. */
const lagBadge = (id: string) =>
  screen.queryByLabelText(new RegExp(`^${cameraName(id)} 판정 지연`));
/** 칸 오른쪽 위 끊김 배지. 없으면 null. */
const downBadge = (id: string) => screen.queryByLabelText(`${cameraName(id)} 끊김`);

/** 카메라별 지연 표본(최근 몇 초 평균의 재료). */
function seedLag(cameras: Record<string, number>) {
  useRealtimeStore.setState({ lagSamples: [{ at: T, lagMs: 150, cameras }] });
}

beforeEach(() => {
  useCctvStore.getState().reset();
  signIn('ADMIN');
});

afterEach(() => {
  cleanup();
  vi.mocked(useCctvPreview).mockClear();
  resume.mockClear();
  useCctvStore.getState().reset();
  useRealtimeStore.setState(useRealtimeStore.getInitialState(), true);
  useSessionStore.setState({ session: undefined });
});

describe('CctvPage 관리자 · 중계가 이어졌을 때', () => {
  beforeEach(() => {
    seedRealtime();
    openRelay();
  });

  it('카메라 4대를 4분할로 그리고 칸마다 이름과 상태를 보인다', () => {
    render(<CctvPage />);
    for (const id of CAMS) {
      expect(screen.getByRole('button', { name: `${cameraName(id)} 크게 보기` })).toBeTruthy();
      expect(screen.getByLabelText(`${cameraName(id)} 영상`).tagName).toBe('CANVAS');
      expect(screen.getByText(cameraName(id))).toBeTruthy();
    }
    // 이름 옆에 단계 글('표시 중')은 두지 않는다.
    expect(screen.queryByText('표시 중')).toBeNull();
    expect(screen.queryByRole('button', { name: '4분할로 돌아가기' })).toBeNull();
  });

  it('칸 오른쪽 위에 그 카메라의 판정 지연을 초록(<300)·노랑(<600)·빨강(≥600) 배지로 보인다', () => {
    seedLag({ cam_A: 180, cam_B: 450, cam_D: 720 });
    render(<CctvPage />);
    expect(lagBadge('cam_A')!.textContent).toBe('판정 180 ms');
    expect(lagBadge('cam_A')!.className).toContain('text-ok');
    expect(lagBadge('cam_B')!.textContent).toBe('판정 450 ms');
    expect(lagBadge('cam_B')!.className).toContain('text-sev-caution');
    expect(lagBadge('cam_D')!.textContent).toBe('판정 720 ms');
    expect(lagBadge('cam_D')!.className).toContain('text-sev-critical');
    // 지연을 모르는 칸은 배지를 두지 않는다(지어내지 않음). LIVE·실시간 글도 두지 않는다.
    expect(lagBadge('cam_C')).toBeNull();
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.queryByText('실시간')).toBeNull();
    expect(screen.queryByText('끊김')).toBeNull();
  });

  it('그 카메라만 영상이 안 들어오면(키프레임 대기) 그 칸에만 끊김을 보이고 나머지는 지연이다', () => {
    seedRealtime({ at: T + 20_000 });
    seedLag({ cam_A: 180, cam_B: 200, cam_C: 900, cam_D: 210 });
    render(<CctvPage />);
    expect(downBadge('cam_C')!.textContent).toBe('끊김');
    expect(lagBadge('cam_C')).toBeNull();
    expect(screen.getAllByText('끊김')).toHaveLength(1);
    for (const id of ['cam_A', 'cam_B', 'cam_D']) {
      expect(downBadge(id)).toBeNull();
      expect(lagBadge(id)).not.toBeNull();
    }
  });

  it('GPU(Tier 0)가 꺼져 있으면 영상은 그대로 두고 끊김·지연 배지를 하나도 보이지 않는다', () => {
    seedRealtime({ at: T + 20_000, tier0: 'DISCONNECTED' });
    // 끊기기 전 표본이 남아 있어도 보이지 않는다.
    seedLag({ cam_A: 180, cam_C: 900 });
    render(<CctvPage />);
    for (const id of CAMS) {
      expect(screen.getByLabelText(`${cameraName(id)} 영상`).tagName).toBe('CANVAS');
      expect(lagBadge(id)).toBeNull();
      expect(downBadge(id)).toBeNull();
    }
    expect(screen.queryByText('끊김')).toBeNull();
    expect(screen.queryByText(/ms$/)).toBeNull();
  });

  it('World 가 멈추면(정지) 배지를 두지 않는다(S15P31A101-665)', () => {
    seedRealtime({ world: false });
    seedLag({ cam_A: 180 });
    render(<CctvPage />);
    expect(lagBadge('cam_A')).toBeNull();
    expect(screen.queryByText(/정지/)).toBeNull();
  });

  it('칸을 누르면 그 칸을 크게 보고 같은 칸을 다시 누르면 4분할로 돌아간다', () => {
    render(<CctvPage />);
    const canvas = screen.getByLabelText('카메라 2 영상');
    fireEvent.click(screen.getByRole('button', { name: '카메라 2 크게 보기' }));

    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /크게 보기$/ })).toHaveLength(3);
    // 캔버스는 다시 만들어지지 않는다(영상이 끊기지 않는다).
    expect(screen.getByLabelText('카메라 2 영상')).toBe(canvas);

    fireEvent.click(screen.getByRole('button', { name: '카메라 2 작게 보기' }));
    expect(screen.getAllByRole('button', { name: /크게 보기$/ })).toHaveLength(4);
    expect(screen.getByLabelText('카메라 2 영상')).toBe(canvas);
  });

  it('크게 본 화면에서도 지연 배지와 4분할로 버튼이 있다', () => {
    seedLag({ cam_A: 180 });
    render(<CctvPage />);
    fireEvent.click(screen.getByRole('button', { name: '카메라 1 크게 보기' }));
    expect(lagBadge('cam_A')!.textContent).toBe('판정 180 ms');
    fireEvent.click(screen.getByRole('button', { name: '4분할로 돌아가기' }));
    expect(screen.getAllByRole('button', { name: /크게 보기$/ })).toHaveLength(4);
  });

  it('중계가 카메라를 아직 알리지 않았으면 연결 문구만 보인다', () => {
    act(() => useCctvStore.setState({ cameras: [], views: {} }));
    render(<CctvPage />);
    expect(screen.queryAllByRole('button', { name: /크게 보기$/ })).toHaveLength(0);
  });
});

// jsdom 은 칸 크기를 계산하지 않아 800×450 으로 흉내 낸다. 칸 가운데는 (400, 225) 다.
const TILE_BOX = { left: 0, top: 0, width: 800, height: 450 };
const CENTER = { x: 0.5, y: 0.5 };
const at = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, buttons: 1 });

describe('CctvPage 관리자 · 확대·이동', () => {
  beforeEach(() => {
    seedRealtime();
    openRelay();
  });

  function sizedTile(id: string) {
    const tile = screen.getByRole('button', {
      name: new RegExp(`^${cameraName(id)} (크게|작게) 보기$`),
    });
    vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue(TILE_BOX as DOMRect);
    return tile;
  }
  const canvasOf = (id: string) =>
    screen.getByLabelText<HTMLCanvasElement>(`${cameraName(id)} 영상`);
  const wheelUp = (tile: HTMLElement, deltaY = -500) =>
    fireEvent.wheel(tile, { deltaY, clientX: 400, clientY: 225 });
  const dragTo = (tile: HTMLElement, x: number, y: number) => {
    fireEvent.pointerDown(tile, at(400, 225));
    fireEvent.pointerMove(tile, at(x, y));
    fireEvent.pointerUp(tile, at(x, y));
  };
  const zoomedView = zoomAt(IDENTITY_VIEW, CENTER, wheelFactor(-500, 0));

  it('휠을 위로 굴리면 영상이 포인터 밑을 기준으로 확대되고 작은 지도가 뜬다', () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    expect(canvasOf('cam_B').style.transform).toBe('');
    expect(screen.queryByRole('img', { name: '확대한 자리' })).toBeNull();

    wheelUp(tile);

    expect(canvasOf('cam_B').style.transform).toBe(panZoomTransform(zoomedView));
    const area = screen.getByRole('img', { name: '확대한 자리' }).firstElementChild as HTMLElement;
    const rect = visibleRect(zoomedView);
    expect(parseFloat(area.style.left)).toBeCloseTo(rect.left * 100, 3);
    expect(parseFloat(area.style.width)).toBeCloseTo(rect.width * 100, 3);
    // 다른 칸은 그대로다.
    expect(canvasOf('cam_A').style.transform).toBe('');
  });

  it('휠은 페이지 스크롤을 막고, 아래로 굴려 1배까지 줄이면 확대가 풀린다', () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    expect(wheelUp(tile)).toBe(false);
    fireEvent.wheel(tile, { deltaY: 5000, clientX: 400, clientY: 225 });
    expect(canvasOf('cam_B').style.transform).toBe('');
    expect(screen.queryByRole('img', { name: '확대한 자리' })).toBeNull();
  });

  it('확대하기 전에는 끌어도 옮겨지지 않고 누르면 그대로 크게 보기로 바뀐다', () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    dragTo(tile, 700, 225);
    expect(canvasOf('cam_B').style.transform).toBe('');
    fireEvent.click(tile, { detail: 1 });
    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBeTruthy();
  });

  it(`확대 중 ${DRAG_THRESHOLD_PX}px 넘게 끌면 옮겨지고, 놓은 뒤 이어지는 클릭은 크게 보기를 바꾸지 않는다`, () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    wheelUp(tile);

    dragTo(tile, 500, 225);

    // 오른쪽으로 100px(칸 폭의 1/8) 끌면 그림이 그만큼 따라온다.
    expect(canvasOf('cam_B').style.transform).toBe(panZoomTransform(panBy(zoomedView, 0.125, 0)));
    fireEvent.click(tile, { detail: 1 });
    expect(screen.getByRole('button', { name: '카메라 2 크게 보기' })).toBe(tile);
    // 삼킨 것은 그 한 번뿐이라 다음 클릭은 크게 보기로 바뀐다.
    fireEvent.click(tile, { detail: 1 });
    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBe(tile);
  });

  it(`확대 중 ${DRAG_THRESHOLD_PX}px 이하로 움직인 누르기는 클릭이라 옮겨지지 않는다`, () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    wheelUp(tile);
    const before = canvasOf('cam_B').style.transform;

    dragTo(tile, 400 + DRAG_THRESHOLD_PX, 225);
    fireEvent.click(tile, { detail: 1 });

    expect(canvasOf('cam_B').style.transform).toBe(before);
    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBe(tile);
  });

  it('확대한 채 크게 보기와 4분할을 오가도 같은 캔버스에 같은 자리가 남는다', () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    const canvas = canvasOf('cam_B');
    wheelUp(tile);
    const zoomed = canvas.style.transform;

    fireEvent.click(tile);
    expect(screen.getByRole('button', { name: '카메라 2 작게 보기' })).toBe(tile);
    expect(canvasOf('cam_B')).toBe(canvas);
    expect(canvas.style.transform).toBe(zoomed);

    fireEvent.click(tile);
    expect(canvas.style.transform).toBe(zoomed);
  });

  it('+ 는 확대하고 0 은 1배로 되돌린다. 브라우저 확대 키(Ctrl)는 건드리지 않는다', () => {
    render(<CctvPage />);
    const tile = sizedTile('cam_B');
    fireEvent.keyDown(tile, { key: '+' });
    expect(canvasOf('cam_B').style.transform).not.toBe('');

    expect(fireEvent.keyDown(tile, { key: '0', ctrlKey: true })).toBe(true);
    expect(canvasOf('cam_B').style.transform).not.toBe('');

    expect(fireEvent.keyDown(tile, { key: '0' })).toBe(false);
    expect(canvasOf('cam_B').style.transform).toBe('');
  });
});

describe('CctvPage 관리자 · 중계가 이어지지 않았을 때', () => {
  it('연결 상태 한 줄·행동 유도 문구와 모의 화면을 보인다(모의 화면도 크게 볼 수 있다)', () => {
    seedRealtime();
    useCctvStore.getState().setLink('unavailable');
    const { container } = render(<CctvPage />);

    expect(screen.getByRole('status').textContent).toBe('중계 끊김');
    expect(
      screen.getByText('현장 노트북에서 중계 프로그램을 켜세요. 연결되면 바로 보입니다.'),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="cctv-page"]')?.className).toContain(
      'pt-(--notices-h,0px)',
    );
    expect(screen.getByRole('img', { name: '카메라 1 영상' })).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '카메라 3 크게 보기' }));
    expect(screen.getByRole('button', { name: '카메라 3 작게 보기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4분할로 돌아가기' })).toBeTruthy();
  });
});

describe('CctvPage 관리자 · 원격 시청(S15P31A101-400)', () => {
  it('입력이 없어 멈추면 안내와 다시 보기를 보이고 누르면 다시 붙는다', () => {
    seedRealtime();
    const store = useCctvStore.getState();
    store.setMode('remote');
    store.setPause('idle');
    store.setLink('stopped');
    render(<CctvPage />);
    expect(screen.getByLabelText('원격 시청 안내').textContent).toContain('10분 동안 입력이 없어');
    fireEvent.click(screen.getByRole('button', { name: '다시 보기' }));
    expect(resume).toHaveBeenCalledOnce();
  });

  it('동시 시청 상한·월 상한이면 그 안내를, 게이트웨이 대기면 다시 보기 없이 안내만 보인다', () => {
    seedRealtime();
    const store = useCctvStore.getState();
    store.setMode('remote');
    store.status({ kind: 'status', protocol: 'simai-cctv-preview/1', state: 'viewer_limit' });
    const { unmount } = render(<CctvPage />);
    expect(screen.getByLabelText('원격 시청 안내').textContent).toContain('동시 시청 인원');
    unmount();

    act(() =>
      store.status({ kind: 'status', protocol: 'simai-cctv-preview/1', state: 'monthly_quota' }),
    );
    render(<CctvPage />);
    expect(screen.getByLabelText('원격 시청 안내').textContent).toContain('송출 한도');
    cleanup();

    act(() =>
      store.status({ kind: 'status', protocol: 'simai-cctv-preview/1', state: 'waiting_source' }),
    );
    render(<CctvPage />);
    expect(screen.getByLabelText('원격 시청 안내').textContent).toContain(
      '서버에 연결되지 않았습니다',
    );
    expect(screen.getByLabelText('원격 시청 안내').textContent).toContain(
      '현장 노트북에서 중계 프로그램을 켜세요',
    );
    expect(screen.queryByRole('button', { name: '다시 보기' })).toBeNull();
  });
});

describe.each(['FOREMAN', 'VIEWER'] as const)('CctvPage %s', (role) => {
  beforeEach(() => signIn(role));

  it('영상 없이 카메라 상태만 보이고 중계에 붙지 않는다', () => {
    seedRealtime({ at: T + 20_000 });
    render(<CctvPage />);

    expect(vi.mocked(useCctvPreview)).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    const text = (id: string) =>
      screen.getByRole('group', { name: `${cameraName(id)} 상태` }).lastElementChild?.textContent;
    expect(text('cam_A')).toBe('실시간');
    expect(text('cam_C')).toBe('끊김');
    expect(screen.getAllByRole('group')).toHaveLength(4);
  });

  it('World 가 멈추면(정지) 상태 글을 두지 않는다', () => {
    seedRealtime({ world: false });
    render(<CctvPage />);
    const group = screen.getByRole('group', { name: '카메라 1 상태' });
    expect(group.textContent).toBe('카메라 1');
  });

  it('실시간 칸은 오른쪽 위에 Tier 0 가 잰 카메라 지연(ms) 배지를 보인다', () => {
    seedRealtime({ at: T + 20_000 });
    seedLag({ cam_A: 180, cam_C: 400 });
    render(<CctvPage />);
    const text = (id: string) =>
      screen.getByRole('group', { name: `${cameraName(id)} 상태` }).lastElementChild?.textContent;
    expect(text('cam_A')).toBe('실시간');
    expect(lagBadge('cam_A')!.textContent).toBe('판정 180 ms');
    // 끊김(cam_C 키프레임 대기)은 가운데 글로만 보이고 지연·끊김 배지는 두지 않는다.
    expect(text('cam_C')).toBe('끊김');
    expect(lagBadge('cam_C')).toBeNull();
    expect(downBadge('cam_C')).toBeNull();
  });

  it('Tier 0 상태를 받지 못하면 안내 한 줄만 보인다', () => {
    seedRealtime({ tier0: 'DISCONNECTED' });
    render(<CctvPage />);
    expect(screen.getByRole('status').textContent).toBe('카메라 상태를 받지 못했습니다');
    expect(screen.queryAllByRole('group')).toHaveLength(0);
  });
});

import { remoteViewUrl } from '@/features/cctv/api';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { IDLE_MS, LOCAL_PROBE_MS, startCctvView, WATCH_MS } from '@/features/cctv/cctvView';
import {
  RECONNECT_MS,
  startPreviewSession,
  type DecoderLike,
  type PreviewDeps,
  type SocketLike,
} from '@/features/cctv/previewSession';
import { beforeEach, describe, expect, it } from 'vitest';

// CCTV 원격 시청(S15P31A101-400): 로컬 먼저 짧게·안 되면 원격, 입장권 주소, status, 딴짓 방지. 소켓·타이머는 가짜다.

const LOCAL = 'ws://127.0.0.1:47032';
const T0 = 1_762_041_600_000;

class FakeSocket implements SocketLike {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  drop() {
    this.onclose?.();
  }
  text(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const decoder: DecoderLike = {
  state: 'configured',
  decodeQueueSize: 0,
  configure: () => {},
  decode: () => {},
  close: () => {},
};

function setup() {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, { fn: () => void; at: number; ms: number }>();
  let next = 0;
  let now = T0;
  const tickets: string[] = [];
  let failTicket = false;
  const deps: PreviewDeps = {
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    createDecoder: () => decoder,
    render: () => {},
    now: () => now,
    setTimer: (fn, ms) => {
      timers.set(++next, { fn, at: now + ms, ms });
      return next;
    },
    clearTimer: (id) => timers.delete(id as number),
  };
  const remoteUrl = () => {
    if (failTicket) return Promise.reject(new Error('403'));
    const ticket = `t${tickets.length + 1}`;
    tickets.push(ticket);
    return Promise.resolve(`wss://simai.live/ws/cctv/view?ticket=${ticket}`);
  };
  /** 시각을 ms 만큼 옮기고 그때까지 울릴 타이머를 차례로 부른다. */
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      if (due.length === 0) return;
      const [id, t] = due[0];
      timers.delete(id);
      t.fn();
    }
  };
  return {
    deps,
    sockets,
    timers,
    tickets,
    remoteUrl,
    advance,
    setFailTicket: (v: boolean) => (failTicket = v),
    socket: () => sockets[sockets.length - 1],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const store = () => useCctvStore.getState();

beforeEach(() => useCctvStore.getState().reset());

describe('원격 시청 주소', () => {
  it('서버가 준 경로를 STOMP 주소의 출처에 붙이고 입장권을 싣는다', () => {
    expect(remoteViewUrl('wss://simai.live/ws', '/ws/cctv/view', 'a+b/c')).toBe(
      'wss://simai.live/ws/cctv/view?ticket=a%2Bb%2Fc',
    );
    expect(remoteViewUrl('ws://localhost:8080/ws', '/ws/cctv/view', 't')).toBe(
      'ws://localhost:8080/ws/cctv/view?ticket=t',
    );
  });
});

describe('원격 시청 연결(previewSession, 주소를 연결마다 받음)', () => {
  it('연결마다 새 입장권으로 붙고, 입장권을 못 받으면 잠시 뒤 다시 받는다', async () => {
    const t = setup();
    t.setFailTicket(true);
    startPreviewSession(t.remoteUrl, t.deps, store());
    await flush();
    expect(store().link).toBe('unavailable');
    expect(t.sockets).toHaveLength(0);
    t.setFailTicket(false);
    t.advance(RECONNECT_MS);
    await flush();
    expect(t.socket().url).toContain('ticket=t1');
    t.socket().open();
    t.socket().drop();
    t.advance(RECONNECT_MS);
    await flush();
    expect(t.socket().url).toContain('ticket=t2');
  });

  it('status 를 화면 상태에 두고, viewer_limit·monthly_quota 로 닫히면 다시 붙지 않는다', async () => {
    const t = setup();
    startPreviewSession(t.remoteUrl, t.deps, store());
    await flush();
    t.socket().open();
    t.socket().text({
      kind: 'status',
      protocol: 'simai-cctv-preview/1',
      state: 'live',
      monthly_sent_bytes: 10,
      monthly_quota_bytes: 100,
    });
    expect(store().remote).toEqual({ state: 'live', monthlySentBytes: 10, monthlyQuotaBytes: 100 });
    t.socket().text({ kind: 'status', protocol: 'simai-cctv-preview/1', state: 'viewer_limit' });
    t.socket().drop();
    expect(store().link).toBe('stopped');
    expect(t.timers.size).toBe(0);
  });
});

describe('로컬 먼저, 안 되면 원격(cctvView)', () => {
  it('로컬이 열리면 로컬을 쓰고 입장권을 받지 않는다', async () => {
    const t = setup();
    startCctvView({ localUrl: LOCAL, remoteUrl: t.remoteUrl }, t.deps, store());
    expect(store().mode).toBe('probing');
    expect(t.socket().url).toBe(LOCAL);
    t.socket().open();
    expect(store()).toMatchObject({ mode: 'local', link: 'open' });
    t.advance(LOCAL_PROBE_MS * 2);
    await flush();
    expect(t.tickets).toHaveLength(0);
    // 로컬이 끊겨도 로컬로 다시 붙는다
    t.socket().drop();
    t.advance(RECONNECT_MS);
    expect(t.socket().url).toBe(LOCAL);
    expect(store().mode).toBe('local');
  });

  it('로컬이 붙지 못하면 바로 원격으로 간다', async () => {
    const t = setup();
    startCctvView({ localUrl: LOCAL, remoteUrl: t.remoteUrl }, t.deps, store());
    const local = t.socket();
    local.drop();
    await flush();
    expect(store().mode).toBe('remote');
    expect(t.socket().url).toContain('ticket=t1');
    // 로컬은 더 시도하지 않는다
    t.advance(RECONNECT_MS * 3);
    expect(t.sockets.filter((s) => s.url === LOCAL)).toHaveLength(1);
  });

  it('로컬이 1.5초 안에 열리지 않으면 원격으로 간다', async () => {
    const t = setup();
    startCctvView({ localUrl: LOCAL, remoteUrl: t.remoteUrl }, t.deps, store());
    t.advance(LOCAL_PROBE_MS);
    await flush();
    expect(t.sockets[0].closed).toBe(true);
    expect(store().mode).toBe('remote');
    expect(t.socket().url).toContain('ticket=t1');
  });
});

describe('원격 시청 딴짓 방지', () => {
  async function remote() {
    const t = setup();
    const view = startCctvView({ localUrl: LOCAL, remoteUrl: t.remoteUrl }, t.deps, store());
    t.socket().drop();
    await flush();
    t.socket().open();
    return { t, view };
  }

  it('탭이 숨으면 닫고, 보이면 새 입장권으로 다시 붙는다', async () => {
    const { t, view } = await remote();
    const first = t.socket();
    view.visibility(true);
    expect(first.closed).toBe(true);
    expect(store().pause).toBe('hidden');
    view.visibility(false);
    await flush();
    expect(t.socket().url).toContain('ticket=t2');
    expect(store().pause).toBeNull();
  });

  it('입력이 10분 없으면 멈추고, 입력이 있으면 그만큼 미룬다', async () => {
    const { t, view } = await remote();
    t.advance(IDLE_MS - 60_000);
    view.activity();
    t.advance(60_000);
    expect(store().pause).toBeNull();
    t.advance(IDLE_MS - 60_000);
    expect(store()).toMatchObject({ pause: 'idle', link: 'stopped' });
    expect(t.socket().closed).toBe(true);
    // 다시 보기
    view.resume();
    await flush();
    expect(store().pause).toBeNull();
    expect(t.socket().url).toContain('ticket=t2');
  });

  it('입력이 있어도 한 번 시청이 30분이면 멈춘다', async () => {
    const { t, view } = await remote();
    for (let at = 0; at < WATCH_MS; at += 60_000) {
      t.advance(60_000);
      view.activity();
    }
    expect(store().pause).toBe('watch_limit');
    expect(t.socket().closed).toBe(true);
  });

  it('멈추면(화면을 떠나면) 소켓을 닫고 타이머를 남기지 않는다', async () => {
    const { t, view } = await remote();
    view.stop();
    expect(t.socket().closed).toBe(true);
    expect(t.timers.size).toBe(0);
  });
});

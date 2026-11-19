import { isStale, noticeText, showsNotice, tileLabel } from '@/features/cctv/cctv';
import { useCctvStore } from '@/features/cctv/cctv.store';
import {
  MAX_DECODE_QUEUE,
  RECONNECT_MS,
  startPreviewSession,
  type ChunkLike,
  type DecodedFrame,
  type DecoderConfigLike,
  type DecoderLike,
  type PreviewDeps,
  type SocketLike,
} from '@/features/cctv/previewSession';
import { nalTypes } from '@/features/cctv/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

// 소켓·WebCodecs 없이: 가짜 소켓에 계약 형식 메시지를 넣고, 가짜 디코더가 받은 것과 화면 상태를 본다.

const URL = 'ws://127.0.0.1:47032';
const SPS = 'Z2QAKqw0yAoA9sBEAAADAAQAAAMA8jxgykA=';
const PPS = 'aO48sA==';
const T0 = 1_761_609_600_000;

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
    this.onerror?.();
    this.onclose?.();
  }
  text(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  frame(cameraId: string, sequence: number, keyframe: boolean, epoch = 5) {
    const header = {
      camera_id: cameraId,
      stream_epoch: epoch,
      frame_sequence: sequence,
      source_pts: sequence * 3600,
      pts_timebase: '1/90000',
      estimated_capture_time_ms: T0 + sequence * 40,
      timestamp_source: 'RECEIVE_ESTIMATED',
      timestamp_uncertainty_ms: 20,
      keyframe,
    };
    const json = new TextEncoder().encode(JSON.stringify(header));
    const au = Uint8Array.of(0, 0, 0, 1, keyframe ? 0x65 : 0x41, sequence & 0xff);
    const out = new Uint8Array(4 + json.length + au.length);
    new DataView(out.buffer).setUint32(0, json.length);
    out.set(json, 4);
    out.set(au, 4 + json.length);
    this.onmessage?.({ data: out.buffer });
  }
}

class FakeDecoder implements DecoderLike {
  state = 'unconfigured';
  decodeQueueSize = 0;
  configs: DecoderConfigLike[] = [];
  chunks: ChunkLike[] = [];
  constructor(
    readonly output: (frame: DecodedFrame) => void,
    readonly error: () => void,
  ) {}
  configure(config: DecoderConfigLike) {
    this.state = 'configured';
    this.configs.push(config);
  }
  decode(chunk: ChunkLike) {
    this.chunks.push(chunk);
  }
  close() {
    this.state = 'closed';
  }
  /** 마지막으로 넣은 것을 풀었다고 낸다. */
  emit() {
    const last = this.chunks[this.chunks.length - 1];
    const frame = { timestamp: last.timestamp, closed: false, close: () => (frame.closed = true) };
    this.output(frame);
    return frame;
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const decoders: FakeDecoder[] = [];
  const rendered: { cameraId: string; frame: DecodedFrame }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let now = T0;
  const deps: PreviewDeps = {
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    createDecoder: (output, error) => {
      const d = new FakeDecoder(output, error);
      decoders.push(d);
      return d;
    },
    render: (cameraId, frame) => rendered.push({ cameraId, frame }),
    now: () => now,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  };
  const session = startPreviewSession(URL, deps, useCctvStore.getState());
  return {
    session,
    sockets,
    decoders,
    rendered,
    timers,
    socket: () => sockets[sockets.length - 1],
    advance: (ms: number) => (now += ms),
  };
}

const hello = { kind: 'hello', protocol: 'simai-cctv-preview/1', cameras: ['cam_A', 'cam_B'] };
const codec = (cameraId: string, epoch = 5) => ({
  kind: 'codec',
  protocol: 'simai-cctv-preview/1',
  codec_info: {
    camera_id: cameraId,
    stream_epoch: epoch,
    codec: 'H264',
    sps: SPS,
    pps: PPS,
    pts_timebase: '1/90000',
    width: 2304,
    height: 1296,
    nominal_fps: 25,
  },
  codec_string: 'avc1.64002A',
});

beforeEach(() => useCctvStore.getState().reset());

describe('미리보기 연결', () => {
  it('루프백 주소로 이진 메시지를 ArrayBuffer 로 받는다', () => {
    const t = setup();
    expect(t.socket().url).toBe(URL);
    expect(t.socket().binaryType).toBe('arraybuffer');
    expect(useCctvStore.getState().link).toBe('connecting');
    t.socket().open();
    expect(useCctvStore.getState()).toMatchObject({ link: 'open', everOpened: true });
  });

  it('붙지 못하면 안내를 보이고 잠시 뒤 다시 붙는다', () => {
    const t = setup();
    t.socket().drop();
    const s = useCctvStore.getState();
    expect(s.link).toBe('unavailable');
    expect(showsNotice(s.link, s.everOpened)).toBe(true);
    expect(noticeText(s.link)).toContain('현장 노트북에서만 표시');
    expect(t.timers.map((x) => x.ms)).toEqual([RECONNECT_MS]);
    t.timers[0].fn();
    expect(t.sockets).toHaveLength(2);
  });

  it('한 번 붙은 뒤 끊기면 칸을 두고 끊김만 보이며 디코더를 닫는다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(hello);
    t.socket().text(codec('cam_A'));
    t.socket().frame('cam_A', 0, true);
    t.socket().drop();
    const s = useCctvStore.getState();
    expect(showsNotice(s.link, s.everOpened)).toBe(false);
    expect(tileLabel(s.views.cam_A?.phase, s.link)).toBe('중계 끊김');
    expect(t.decoders[0].state).toBe('closed');
  });

  it('WebCodecs 가 없으면 안내만 보인다', () => {
    expect(showsNotice('unsupported', true)).toBe(true);
    expect(noticeText('unsupported')).toContain('WebCodecs');
  });

  it('멈추면 소켓과 디코더를 닫고 다시 붙지 않는다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(codec('cam_A'));
    t.socket().frame('cam_A', 0, true);
    t.session.stop();
    expect(t.socket().closed).toBe(true);
    expect(t.decoders[0].state).toBe('closed');
    t.socket().drop();
    expect(t.timers).toHaveLength(0);
  });
});

describe('카메라별 디코딩', () => {
  it('hello 로 칸을 만들고 codec 뒤 키프레임부터 넣는다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(hello);
    expect(useCctvStore.getState().cameras).toEqual(['cam_A', 'cam_B']);
    expect(tileLabel(useCctvStore.getState().views.cam_B?.phase, 'open')).toBe('영상 없음');

    t.socket().frame('cam_A', 0, true); // codec 전: 버림
    t.socket().text(codec('cam_A'));
    expect(useCctvStore.getState().views.cam_A).toMatchObject({
      phase: 'waiting_keyframe',
      width: 2304,
      height: 1296,
    });
    t.socket().frame('cam_A', 1, false); // 키프레임 전: 버림
    expect(t.decoders).toHaveLength(0);

    t.socket().frame('cam_A', 50, true);
    const [d] = t.decoders;
    expect(d.configs).toEqual([
      { codec: 'avc1.64002A', codedWidth: 2304, codedHeight: 1296, optimizeForLatency: true },
    ]);
    expect(d.chunks[0]).toMatchObject({ type: 'key', timestamp: (T0 + 50 * 40) * 1000 });
    expect(nalTypes(d.chunks[0].data)).toEqual([7, 8, 5]); // SPS·PPS 를 앞에 붙였다
    t.socket().frame('cam_A', 51, false);
    expect(d.chunks[1]).toMatchObject({ type: 'delta' });
    expect(nalTypes(d.chunks[1].data)).toEqual([1]);

    const frame = d.emit();
    expect(t.rendered).toEqual([{ cameraId: 'cam_A', frame }]);
    expect(useCctvStore.getState().views.cam_A).toMatchObject({
      phase: 'playing',
      lastCaptureMs: T0 + 51 * 40,
      lastDecodedMs: T0,
    });
  });

  it('다른 stream_epoch 의 프레임은 넣지 않고 새 codec 이면 디코더를 새로 만든다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(codec('cam_A', 5));
    t.socket().frame('cam_A', 0, true, 5);
    t.socket().frame('cam_A', 0, true, 6); // 아직 codec 이 오지 않은 epoch
    expect(t.decoders[0].chunks).toHaveLength(1);
    t.socket().text(codec('cam_A', 6));
    expect(t.decoders[0].state).toBe('closed');
    t.socket().frame('cam_A', 0, true, 6);
    expect(t.decoders).toHaveLength(2);
    expect(t.decoders[1].chunks).toHaveLength(1);
  });

  it('디코더가 밀리면 다음 키프레임까지 건너뛴다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(codec('cam_A'));
    t.socket().frame('cam_A', 0, true);
    const [d] = t.decoders;
    d.decodeQueueSize = MAX_DECODE_QUEUE + 1;
    t.socket().frame('cam_A', 1, false);
    t.socket().frame('cam_A', 2, false);
    expect(d.chunks).toHaveLength(1);
    expect(useCctvStore.getState().views.cam_A?.phase).toBe('waiting_keyframe');
    d.decodeQueueSize = 0;
    t.socket().frame('cam_A', 3, false);
    expect(d.chunks).toHaveLength(1);
    t.socket().frame('cam_A', 50, true);
    expect(d.chunks.map((c) => c.type)).toEqual(['key', 'key']);
  });

  it('디코더 오류면 표시하고 다음 키프레임에서 새 디코더로 다시 시작한다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(codec('cam_A'));
    t.socket().frame('cam_A', 0, true);
    t.decoders[0].error();
    expect(useCctvStore.getState().views.cam_A?.phase).toBe('decode_error');
    t.socket().frame('cam_A', 1, false);
    expect(t.decoders).toHaveLength(1);
    t.socket().frame('cam_A', 50, true);
    expect(t.decoders).toHaveLength(2);
    expect(t.decoders[1].chunks[0].type).toBe('key');
  });

  it('화면 상태의 촬영 시각과 받은 시각은 카메라마다 0.25초에 한 번까지만 바꾼다', () => {
    const t = setup();
    t.socket().open();
    t.socket().text(codec('cam_A'));
    t.socket().frame('cam_A', 0, true);
    const [d] = t.decoders;
    d.emit();
    t.socket().frame('cam_A', 1, false);
    d.emit();
    expect(useCctvStore.getState().views.cam_A).toMatchObject({
      lastCaptureMs: T0,
      lastDecodedMs: T0,
    });
    t.advance(250);
    t.socket().frame('cam_A', 2, false);
    d.emit();
    expect(useCctvStore.getState().views.cam_A).toMatchObject({
      lastCaptureMs: T0 + 80,
      lastDecodedMs: T0 + 250,
    });
    expect(t.rendered).toHaveLength(3); // 그리기는 프레임마다
  });
});

describe('지연 표시', () => {
  it('마지막 프레임이 1초보다 오래되면 지연이다', () => {
    expect(isStale(undefined)).toBe(false);
    expect(isStale(0.5)).toBe(false);
    expect(isStale(1.5)).toBe(true);
  });
});

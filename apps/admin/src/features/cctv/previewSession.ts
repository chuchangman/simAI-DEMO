import type { CameraPhase, PreviewLink } from '@/features/cctv/cctv.store';
import { base64Bytes, parseFrame, parseText, withParameterSets } from '@/features/cctv/protocol';
import type { CodecMessage, RemoteState, StatusMessage } from '@/features/cctv/types';

// 현장 노트북 중계(gateway/relay --preview-port)의 루프백 WebSocket, 또는 EC2 원격 시청 WebSocket(/ws/cctv/view, 같은 형식)에
// 붙어 카메라마다 디코더 하나로 H.264 를 푼다. 소켓·디코더·그리기는 주입받아(브라우저: webcodecs.ts) 소켓·WebCodecs 없이 시험한다.
// - 주소는 고정 문자열(로컬) 또는 연결마다 새로 받는 함수(원격: 일회용 입장권을 받아 주소를 만든다)다.
// - 원격 status 가 viewer_limit·monthly_quota 면 서버가 닫고, 다시 붙지 않는다(link stopped, 사용자가 다시 보기를 누른다).
// - 카메라별 codec 을 받은 뒤 그 stream_epoch 의 키프레임부터 넣는다(중계도 키프레임부터 보낸다).
// - 디코더가 밀리면(대기 상한) 다음 키프레임까지 건너뛴다. 지난 프레임을 쌓아 늦게 그리지 않는다.
// - 끊기면 디코더를 닫고 RECONNECT_MS 뒤 다시 붙는다(중계를 나중에 켜도 이어진다).

export const RECONNECT_MS = 3000;
export const MAX_DECODE_QUEUE = 8;
/** 마지막 프레임 촬영 시각을 화면 상태에 올리는 최소 간격(카메라마다). */
export const PLAYED_PUSH_MS = 250;

export interface SocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
}

/** 디코더가 내는 프레임(VideoFrame 의 쓰는 부분). 받은 쪽이 close 한다. */
export interface DecodedFrame {
  /** 마이크로초. 넣을 때 추정 촬영 시각(ms) × 1000 으로 넣는다. */
  timestamp: number;
  close: () => void;
}

export interface DecoderConfigLike {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  optimizeForLatency: boolean;
}

export interface ChunkLike {
  type: 'key' | 'delta';
  timestamp: number;
  data: Uint8Array;
}

/** VideoDecoder 의 쓰는 부분. */
export interface DecoderLike {
  readonly state: string;
  readonly decodeQueueSize: number;
  configure: (config: DecoderConfigLike) => void;
  decode: (chunk: ChunkLike) => void;
  close: () => void;
}

export interface PreviewDeps {
  openSocket: (url: string) => SocketLike;
  createDecoder: (output: (frame: DecodedFrame) => void, error: () => void) => DecoderLike;
  /** 프레임을 캔버스에 그린다. 프레임을 넘겨받으므로 close 는 render 가 한다. */
  render: (cameraId: string, frame: DecodedFrame) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
}

/** 이 상태를 받으면 서버가 연결을 닫는다. 다시 붙지 않는다. */
const HALT_STATES: ReadonlySet<RemoteState> = new Set(['viewer_limit', 'monthly_quota']);

/** 연결 주소. 함수면 연결(다시 붙기 포함)마다 새로 받는다. */
export type UrlSource = string | (() => Promise<string>);

/** 화면 상태에 쓰는 동작(cctv.store 의 액션). */
export interface PreviewSink {
  setLink: (link: PreviewLink) => void;
  hello: (cameras: string[]) => void;
  codec: (cameraId: string, width: number, height: number) => void;
  waitKeyframe: (cameraId: string) => void;
  played: (cameraId: string, captureMs: number, decodedMs: number) => void;
  decodeError: (cameraId: string) => void;
  /** 원격 시청 상태(EC2 가 보낸 status). 로컬 미리보기는 보내지 않는다. */
  status?: (message: StatusMessage) => void;
}

interface CameraState {
  codec: CodecMessage;
  sps: Uint8Array;
  pps: Uint8Array;
  decoder?: DecoderLike;
  waitingKey: boolean;
  phase: CameraPhase;
  lastPushMs: number;
}

export interface PreviewSession {
  stop: () => void;
}

export function startPreviewSession(
  url: UrlSource,
  deps: PreviewDeps,
  sink: PreviewSink,
): PreviewSession {
  const cameras = new Map<string, CameraState>();
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let stopped = false;
  let halted = false;
  let attempt = 0;

  const closeDecoder = (cam: CameraState) => {
    if (cam.decoder && cam.decoder.state !== 'closed') cam.decoder.close();
    cam.decoder = undefined;
  };

  const fail = (cameraId: string, cam: CameraState) => {
    closeDecoder(cam);
    cam.waitingKey = true;
    cam.phase = 'decode_error';
    sink.decodeError(cameraId);
  };

  const ensureDecoder = (cameraId: string, cam: CameraState): DecoderLike | undefined => {
    if (cam.decoder && cam.decoder.state !== 'closed') return cam.decoder;
    try {
      const decoder = deps.createDecoder(
        (frame) => {
          if (stopped || cameras.get(cameraId) !== cam) {
            frame.close();
            return;
          }
          deps.render(cameraId, frame);
          const now = deps.now();
          if (cam.phase !== 'playing' || now - cam.lastPushMs >= PLAYED_PUSH_MS) {
            cam.phase = 'playing';
            cam.lastPushMs = now;
            sink.played(cameraId, frame.timestamp / 1000, now);
          }
        },
        () => {
          if (cameras.get(cameraId) === cam && cam.decoder === decoder) fail(cameraId, cam);
        },
      );
      decoder.configure({
        codec: cam.codec.codec_string,
        codedWidth: cam.codec.codec_info.width,
        codedHeight: cam.codec.codec_info.height,
        optimizeForLatency: true,
      });
      cam.decoder = decoder;
      return decoder;
    } catch {
      fail(cameraId, cam);
      return undefined;
    }
  };

  const onText = (data: string) => {
    const message = parseText(data);
    if (!message) return;
    if (message.kind === 'status') {
      if (HALT_STATES.has(message.state)) halted = true;
      sink.status?.(message);
      return;
    }
    if (message.kind === 'hello') {
      sink.hello(message.cameras);
      return;
    }
    const { camera_id: cameraId, width, height } = message.codec_info;
    const previous = cameras.get(cameraId);
    if (previous) closeDecoder(previous);
    cameras.set(cameraId, {
      codec: message,
      sps: base64Bytes(message.codec_info.sps),
      pps: base64Bytes(message.codec_info.pps),
      waitingKey: true,
      phase: 'waiting_keyframe',
      lastPushMs: 0,
    });
    sink.codec(cameraId, width, height);
  };

  const onFrame = (buffer: ArrayBuffer) => {
    const frame = parseFrame(buffer);
    if (!frame) return;
    const { header, data } = frame;
    const cam = cameras.get(header.camera_id);
    // codec 이 없거나 다른 stream_epoch 의 프레임은 그 SPS 로 풀 수 없다
    if (!cam || header.stream_epoch !== cam.codec.codec_info.stream_epoch) return;
    if (cam.waitingKey && !header.keyframe) return;
    const decoder = ensureDecoder(header.camera_id, cam);
    if (!decoder) return;
    if (!header.keyframe && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      cam.waitingKey = true;
      if (cam.phase !== 'waiting_keyframe') {
        cam.phase = 'waiting_keyframe';
        sink.waitKeyframe(header.camera_id);
      }
      return;
    }
    try {
      decoder.decode({
        type: header.keyframe ? 'key' : 'delta',
        timestamp: header.estimated_capture_time_ms * 1000,
        data: header.keyframe ? withParameterSets(data, cam.sps, cam.pps) : data,
      });
      cam.waitingKey = false;
    } catch {
      fail(header.camera_id, cam);
    }
  };

  const retry = () => {
    sink.setLink('unavailable');
    if (stopped) return; // 알림을 받은 쪽이 멈췄다(로컬 시도에 실패해 원격으로 감)
    timer = deps.setTimer(connect, RECONNECT_MS);
  };

  const connect = () => {
    timer = null;
    if (stopped) return;
    sink.setLink('connecting');
    if (typeof url === 'string') {
      open(url);
      return;
    }
    const mine = ++attempt;
    url().then(
      (resolved) => {
        if (!stopped && mine === attempt) open(resolved);
      },
      () => {
        if (!stopped && mine === attempt) retry();
      },
    );
  };

  const open = (target: string) => {
    let ws: SocketLike;
    try {
      ws = deps.openSocket(target);
    } catch {
      retry();
      return;
    }
    socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      if (socket === ws) sink.setLink('open');
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      if (typeof event.data === 'string') onText(event.data);
      else if (event.data instanceof ArrayBuffer) onFrame(event.data);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      for (const cam of cameras.values()) closeDecoder(cam);
      cameras.clear();
      if (stopped) return;
      if (halted) {
        sink.setLink('stopped');
        return;
      }
      retry();
    };
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      const ws = socket;
      socket = null;
      ws?.close();
      for (const cam of cameras.values()) closeDecoder(cam);
      cameras.clear();
    },
  };
}

import type { DecodedFrame, PreviewDeps, SocketLike } from '@/features/cctv/previewSession';

// 브라우저 쪽 붙이기: WebSocket, WebCodecs VideoDecoder, 캔버스 그리기. 시험은 previewSession 에 가짜를 넣는다.

/** 카메라 영상 색 해석(스트림에 색 정보가 없을 때 디코더가 쓴다). */
export const CCTV_COLOR_SPACE: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

/** 이 브라우저가 WebCodecs 로 H.264 를 풀 수 있는지(없으면 미리보기를 열지 않는다). */
export function hasWebCodecs(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

/**
 * 카메라별 캔버스. 디코더가 낸 프레임은 바로 그리지 않고 다음 화면 갱신(requestAnimationFrame)에 가장 새 것 하나만
 * 그린다(밀린 프레임은 닫고 버린다). 캔버스 크기는 프레임 원본 해상도(2304x1296)이고 CSS 로 줄여 보인다.
 */
export function createCanvasRenderer() {
  const canvases = new Map<string, HTMLCanvasElement>();
  const pending = new Map<string, VideoFrame>();
  let scheduled = false;

  const draw = () => {
    scheduled = false;
    for (const [cameraId, frame] of pending) {
      const canvas = canvases.get(cameraId);
      if (canvas) {
        if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
        if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
      }
      frame.close();
    }
    pending.clear();
  };

  return {
    attach(cameraId: string, canvas: HTMLCanvasElement | null) {
      if (canvas) canvases.set(cameraId, canvas);
      else canvases.delete(cameraId);
    },
    render(cameraId: string, frame: DecodedFrame) {
      pending.get(cameraId)?.close();
      pending.set(cameraId, frame as VideoFrame);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(draw);
      }
    },
    /** 밀린 프레임을 닫는다. 캔버스 등록은 ref 가 붙이고 뗀다. */
    dispose() {
      for (const frame of pending.values()) frame.close();
      pending.clear();
    },
  };
}

export type CanvasRenderer = ReturnType<typeof createCanvasRenderer>;

export function browserDeps(renderer: CanvasRenderer): PreviewDeps {
  return {
    openSocket: (url) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      const socket: SocketLike = {
        binaryType: 'arraybuffer',
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        close: () => ws.close(),
      };
      ws.onopen = () => socket.onopen?.();
      ws.onclose = () => socket.onclose?.();
      ws.onerror = () => socket.onerror?.();
      ws.onmessage = (event: MessageEvent<unknown>) => socket.onmessage?.({ data: event.data });
      return socket;
    },
    createDecoder: (output, error) => {
      const decoder = new VideoDecoder({ output, error: () => error() });
      return {
        get state() {
          return decoder.state;
        },
        get decodeQueueSize() {
          return decoder.decodeQueueSize;
        },
        // 하드웨어 디코더는 키프레임(2초)마다 출력을 약 350 ms 붙잡아 멈춤·점프로 보인다(-349). 소프트웨어 디코딩은 25 fps 를 지킨다
        // C110 은 SPS 에 색 정보(VUI colour description·range)를 싣지 않아 해석을 브라우저에 맡기게 된다.
        // Chrome 기본(BT.709 제한 범위, 2026-11-02 실측)·일반 플레이어·Tier 0(PyAV swscale 기본)과 같은 값으로 고정해
        // 브라우저가 달라도 같은 색으로 보이게 한다(사용자 선택 A)
        configure: (config) =>
          decoder.configure({
            ...config,
            hardwareAcceleration: 'prefer-software',
            colorSpace: CCTV_COLOR_SPACE,
          }),
        decode: (chunk) => decoder.decode(new EncodedVideoChunk(chunk)),
        close: () => decoder.close(),
      };
    },
    render: (cameraId, frame) => renderer.render(cameraId, frame),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

import type { RemoteState, StatusMessage } from '@/features/cctv/types';
import { create } from 'zustand';

// CCTV 미리보기(로컬·원격) 화면 상태. 프레임마다 바꾸지 않는다: 그리기는 캔버스가 직접 하고, 여기에는 연결·카메라 단계와
// 마지막으로 그린 프레임의 촬영 시각·받은 시각(카메라마다 0.25초에 한 번까지)만 둔다.

/**
 * connecting: 여는 중(처음·다시), open: 중계(로컬) 또는 EC2(원격)와 이어짐, unavailable: 붙지 못함(다시 시도 중),
 * unsupported: 이 브라우저에 WebCodecs VideoDecoder 가 없다, stopped: 원격 시청을 멈춤(다시 보기를 눌러야 이어짐).
 */
export type PreviewLink = 'connecting' | 'open' | 'unavailable' | 'unsupported' | 'stopped';

/** probing: 로컬 미리보기를 짧게 시도하는 중, local: 같은 노트북 중계(127.0.0.1), remote: EC2 원격 시청. */
export type ViewMode = 'probing' | 'local' | 'remote';

/** 원격 시청을 멈춘 까닭. idle: 입력 없음 10분, watch_limit: 한 번 시청 30분, hidden: 탭이 숨음(보이면 다시 붙음). */
export type PauseReason = 'idle' | 'watch_limit' | 'hidden';

export interface RemoteView {
  state: RemoteState;
  monthlySentBytes?: number;
  monthlyQuotaBytes?: number;
}

/**
 * no_video: 중계가 이 카메라의 영상을 아직 못 받음(codec 없음), waiting_keyframe: codec 은 왔고 키프레임 대기,
 * playing: 그리는 중, decode_error: 디코더 오류(다음 키프레임에서 다시 시작).
 */
export type CameraPhase = 'no_video' | 'waiting_keyframe' | 'playing' | 'decode_error';

export interface CameraView {
  phase: CameraPhase;
  width?: number;
  height?: number;
  /** 마지막으로 그린 프레임의 추정 촬영 시각(UTC ms). */
  lastCaptureMs?: number;
  /** 마지막으로 그린 프레임을 디코더가 내놓은 시각(브라우저 시계 ms). 촬영 시각과 달리 전송 지연·기계 간 시계 차이가 없다. */
  lastDecodedMs?: number;
}

interface CctvState {
  link: PreviewLink;
  /** 중계가 hello 로 알린 카메라(설정 순서). 연결 전에는 비어 있다. */
  cameras: string[];
  views: Record<string, CameraView>;
  /** 이번 화면에서 한 번이라도 중계에 붙었는지. 끊겨도 마지막 화면을 안내로 덮지 않는다. */
  everOpened: boolean;
  mode: ViewMode;
  pause: PauseReason | null;
  /** 원격 시청에서 마지막으로 받은 status. */
  remote: RemoteView | null;
  setLink: (link: PreviewLink) => void;
  setMode: (mode: ViewMode) => void;
  setPause: (pause: PauseReason | null) => void;
  status: (message: StatusMessage) => void;
  hello: (cameras: string[]) => void;
  codec: (cameraId: string, width: number, height: number) => void;
  waitKeyframe: (cameraId: string) => void;
  played: (cameraId: string, captureMs: number, decodedMs: number) => void;
  decodeError: (cameraId: string) => void;
  reset: () => void;
}

const initial = {
  link: 'connecting' as PreviewLink,
  cameras: [],
  views: {},
  everOpened: false,
  mode: 'probing' as ViewMode,
  pause: null,
  remote: null,
};

const patch = (
  views: Record<string, CameraView>,
  cameraId: string,
  next: Partial<CameraView>,
): Record<string, CameraView> => ({
  ...views,
  [cameraId]: { ...(views[cameraId] ?? { phase: 'no_video' }), ...next },
});

export const useCctvStore = create<CctvState>()((set) => ({
  ...initial,
  setLink: (link) => set((s) => ({ link, everOpened: s.everOpened || link === 'open' })),
  setMode: (mode) => set({ mode }),
  // 멈추거나 다시 볼 때 지난 원격 status 는 지운다(다시 붙으면 새로 온다)
  setPause: (pause) => set({ pause, remote: null }),
  status: (message) =>
    set({
      remote: {
        state: message.state,
        monthlySentBytes: message.monthly_sent_bytes,
        monthlyQuotaBytes: message.monthly_quota_bytes,
      },
    }),
  hello: (cameras) =>
    set((s) => ({
      cameras,
      views: Object.fromEntries(
        cameras.map((id) => [id, s.views[id] ?? ({ phase: 'no_video' } as CameraView)]),
      ),
    })),
  codec: (cameraId, width, height) =>
    set((s) => ({ views: patch(s.views, cameraId, { phase: 'waiting_keyframe', width, height }) })),
  waitKeyframe: (cameraId) =>
    set((s) =>
      s.views[cameraId]?.phase === 'waiting_keyframe'
        ? s
        : { views: patch(s.views, cameraId, { phase: 'waiting_keyframe' }) },
    ),
  played: (cameraId, captureMs, decodedMs) =>
    set((s) => ({
      views: patch(s.views, cameraId, {
        phase: 'playing',
        lastCaptureMs: captureMs,
        lastDecodedMs: decodedMs,
      }),
    })),
  decodeError: (cameraId) =>
    set((s) => ({ views: patch(s.views, cameraId, { phase: 'decode_error' }) })),
  reset: () => set(initial),
}));

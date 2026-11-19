import {
  captureCollecting,
  captureFailed,
  deriveCaptureView,
  remainingSeconds,
  type CaptureView,
} from '@/features/setup/backgroundCapture';
import type { Stage } from '@/features/setup/setup';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useCallback, useEffect, useState } from 'react';

// 세팅 배경 촬영 창(S15P31A101-686)의 열림·닫힘과 카운트다운.
// - 1단계 '다음' 이 창을 「시작」 전 상태로 연다(begin). 「시작」을 누르면(start) 부모가 세팅 세션을 만든다.
// - 세션이 배경 수집 단계면(새로고침·다시 시도 포함) 창을 촬영 중으로 열고, 다음 단계로 넘어가면 저절로 닫는다.
// - 배경을 끝내 못 찍어 끝나면(BACKGROUND_INCOMPLETE) 닫지 않고 그 카메라를 알린다(닫기·다시 촬영은 사용자가 고른다).
// 카운트다운은 워커가 촬영 진행(background_capture)을 처음 알린 때부터 센다(대여를 기다리는 동안은 세지 않는다).

type Mode = 'closed' | 'ready' | 'live';

const TICK_MS = 500;

export interface BackgroundCaptureState {
  open: boolean;
  view: CaptureView;
  secondsLeft: number;
  waitingForWorker: boolean;
  waitingSeconds: number;
  /** 1단계 '다음': 「시작」 전 창을 연다. */
  begin: () => void;
  /** 「시작」: 촬영 중 창으로 바꾼다(세션 만들기는 부모가 한다). */
  start: () => void;
  close: () => void;
}

export function useBackgroundCapture({
  stage,
  session,
  cameraIds,
  starting,
}: {
  stage: Stage;
  session: SetupSessionResponse | null;
  cameraIds: readonly string[];
  /** 세션을 만들거나 다시 시도하는 요청이 진행 중이다. */
  starting: boolean;
}): BackgroundCaptureState {
  const [mode, setMode] = useState<Mode>('closed');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<{ id: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 「시작」 뒤 세션 요청이 실제로 나간 것을 봤는지(요청이 끝났는데 세션이 없으면 시작 실패로 닫는다)
  const [sawStarting, setSawStarting] = useState(false);

  const collecting = stage !== 0 && captureCollecting(session);
  // 배경 수집 중인 세션을 보면 그 세션의 촬영 창으로 연다(새로 만든 세션·다시 시도한 세션·새로고침)
  if (collecting && session && (mode !== 'live' || sessionId !== session.setup_session_id)) {
    setMode('live');
    setSessionId(session.setup_session_id);
    setSawStarting(false);
  }
  if (mode === 'live' && starting && !sawStarting) setSawStarting(true);
  const captureSession =
    sessionId !== null && session?.setup_session_id === sessionId ? session : null;
  if (mode === 'live' && !collecting) {
    // 다음 단계로 넘어갔거나(못 찍고 끝난 세션은 열어 둔다), 시작 요청이 실패해(오류는 1단계에 보인다) 촬영할 세션이 없다
    const movedOn = captureSession !== null && !captureFailed(captureSession);
    const lost = captureSession === null && sessionId !== null;
    const startEnded = sessionId === null && sawStarting && !starting;
    if (movedOn || lost || startEnded) {
      setMode('closed');
      setSessionId(null);
      setSawStarting(false);
    }
  }

  const reported =
    captureSession?.background_capture != null ||
    Object.values(captureSession?.background_collection_pct ?? {}).some((pct) => pct > 0);
  const captureId = captureSession?.setup_session_id ?? null;
  const ticking = mode === 'live';
  useEffect(() => {
    if (!ticking || !captureId) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      // 첫 박자에 이 세션의 촬영 시작 시각을 잡는다(그 전에는 CAPTURE_SECONDS 를 보인다)
      if (reported)
        setStartedAt((prev) => (prev && prev.id === captureId ? prev : { id: captureId, at: t }));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [ticking, captureId, reported]);

  const view = deriveCaptureView(captureSession, cameraIds, mode === 'live' && !captureSession);
  const begin = useCallback(() => {
    setMode('ready');
    setSessionId(null);
  }, []);
  const start = useCallback(() => setMode('live'), []);
  const close = useCallback(() => {
    setMode('closed');
    setSessionId(null);
    setSawStarting(false);
  }, []);
  return {
    open: mode !== 'closed',
    view,
    secondsLeft: remainingSeconds(
      startedAt && startedAt.id === captureId ? startedAt.at : null,
      now,
    ),
    waitingForWorker: view.phase === 'capturing' && !reported,
    waitingSeconds: Math.max(0, Math.floor((now - (captureSession?.started_at_ms ?? now)) / 1000)),
    begin,
    start,
    close,
  };
}

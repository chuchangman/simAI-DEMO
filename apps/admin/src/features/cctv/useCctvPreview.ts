import { requestRemoteViewUrl } from '@/features/cctv/api';
import { useCctvStore } from '@/features/cctv/cctv.store';
import { startCctvView, type CctvView } from '@/features/cctv/cctvView';
import { browserDeps, createCanvasRenderer, hasWebCodecs } from '@/features/cctv/webcodecs';
import { api } from '@/lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 원격 시청의 입력 없음 시간을 처음부터 세는 입력. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * CCTV 화면에 있는 동안만 연결한다(떠나면 닫혀 원격 시청자에서 빠진다). 같은 노트북의 중계 미리보기(localUrl)를 먼저 짧게 시도하고,
 * 안 되면 EC2 원격 시청(stompUrl 과 같은 EC2)으로 붙는다. 상태는 cctv.store 로, 영상은 캔버스로 바로 간다.
 * attach 를 카메라 칸 캔버스의 ref 로, resume 을 원격 "다시 보기" 버튼에 쓴다.
 */
export function useCctvPreview(localUrl: string, stompUrl: string) {
  const [renderer] = useState(createCanvasRenderer);
  const view = useRef<CctvView | null>(null);
  useEffect(() => {
    const store = useCctvStore.getState();
    store.reset();
    if (!hasWebCodecs()) {
      store.setLink('unsupported');
      return;
    }
    const current = startCctvView(
      { localUrl, remoteUrl: () => requestRemoteViewUrl(api, stompUrl) },
      browserDeps(renderer),
      store,
    );
    view.current = current;
    const onActivity = () => current.activity();
    const onVisibility = () => current.visibility(document.visibilityState === 'hidden');
    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      current.stop();
      view.current = null;
      renderer.dispose();
      useCctvStore.getState().reset();
    };
  }, [localUrl, stompUrl, renderer]);
  const resume = useCallback(() => view.current?.resume(), []);
  return { attach: renderer.attach, resume };
}

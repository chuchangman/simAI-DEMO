import { requestGpuPresence } from '@/features/gpu/api';
import { api } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

// 관리자 화면 조작 신호(S15P31A101-708, -774). 서버는 Tier 0 가 붙어 있을 때 이것을 GPU 사용으로 세어 유휴 자동 정지를 미룬다
// (조작만으로 미루는 시간에는 서버 상한 simai.gpu.presence-max-extension 이 있다).
// 보내는 조건(-774, 11-16 화면 5곳을 열어 둔 채 GPU 가 2시간 켜져 있었다): 화면이 실제로 보이고(document.visibilityState=visible)
// 마지막 사용자 조작(누르기·키·터치·휠)이 GPU_PRESENCE_ACTIVE_WINDOW_MS(5분) 안일 때만, 조작 순간과 1분 주기 점검에서
// 최대 1분에 한 번 POST /api/gpu/presence 를 보낸다. 상태 주기 조회(10초)는 화면을 띄워 두기만 해도 오므로 신호로 쓰지 않고,
// 마우스 이동·탭 열림만으로는 보내지 않는다. 실패는 알리지 않는다(다음 조작·점검 때 다시 보낸다).

/** 신호 사이 최소 간격이자 점검 주기. 서버 자동 정지 점검 주기(simai.gpu.sweep-interval 1분)와 같아 더 자주 보내도 소용없다 */
export const GPU_PRESENCE_MIN_INTERVAL_MS = 60_000;

/**
 * 마지막 조작 뒤 이 시간 안에서만 신호를 보낸다(5분). 화면을 읽거나 3D·CCTV 를 보는 동안 몇 분 손을 떼는 것은 사용으로 두고,
 * 자리를 뜬 화면은 서버 유휴 기본 30분보다 훨씬 짧게 사용에서 빠지게 한다. CCTV 원격 시청의 입력 없음 멈춤(10분, cctvView)보다 짧다.
 */
export const GPU_PRESENCE_ACTIVE_WINDOW_MS = 5 * 60_000;

const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export interface GpuPresenceState {
  visible: boolean;
  nowMs: number;
  /** 마지막 사용자 조작 시각(없으면 null) */
  lastInputMs: number | null;
  /** 마지막으로 신호를 보낸 시각(없으면 null) */
  lastSentMs: number | null;
}

/** 지금 조작 신호를 보낼지: 화면이 보이고, 최근 5분 안에 조작이 있고, 마지막 신호 뒤 1분이 지났을 때 */
export function shouldSendGpuPresence({
  visible,
  nowMs,
  lastInputMs,
  lastSentMs,
}: GpuPresenceState): boolean {
  if (!visible || lastInputMs === null) return false;
  if (nowMs - lastInputMs > GPU_PRESENCE_ACTIVE_WINDOW_MS) return false;
  return lastSentMs === null || nowMs - lastSentMs >= GPU_PRESENCE_MIN_INTERVAL_MS;
}

export function useGpuPresence(enabled: boolean): void {
  const { mutate } = useMutation({
    mutationFn: () => requestGpuPresence(api),
  });
  const lastInputRef = useRef<number | null>(null);
  const lastSentRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const trySend = () => {
      const nowMs = Date.now();
      const send = shouldSendGpuPresence({
        visible: document.visibilityState === 'visible',
        nowMs,
        lastInputMs: lastInputRef.current,
        lastSentMs: lastSentRef.current,
      });
      if (!send) return;
      lastSentRef.current = nowMs;
      mutate();
    };
    const onInput = () => {
      lastInputRef.current = Date.now();
      trySend();
    };
    for (const type of INPUT_EVENTS)
      window.addEventListener(type, onInput, { capture: true, passive: true });
    const timer = window.setInterval(trySend, GPU_PRESENCE_MIN_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
    };
  }, [enabled, mutate]);
}

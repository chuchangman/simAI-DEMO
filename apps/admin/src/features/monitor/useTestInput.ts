import { useRealtimeStore } from '@/store/realtime.store';

// 녹화 파일·합성 영상 재생(시험 입력) 중인지(S15P31A101-731, -724 남은 일). EC2 가 노트북 하트비트 cameras[].source_kind 로 판정해
// viewer_health 1.6.0 laptop.test_input 으로 알린다. 재생 중이면 위험 이벤트는 기록·화면 표시만 하고 실제 알림(현장 경보 소리, 워치 진동)은
// 꺼져 있다(AGENTS 규칙 5). 이 칸이 없는 이전 EC2 이면 모르는 것이라 재생 표시를 하지 않는다.
// 재생 시험 알림 스위치(S15P31A101-736, viewer_health 1.7.0 laptop.replay_test_alerts): EC2 .env 로 켜면 재생 중에도 워치 진동이 나간다.
// 그때는 같은 자리에 「재생 시험 · 실제 알림 켜짐」을 크게 보인다(조작 없음, 끄고 켜는 것은 .env 로만).

/** 재생 중 표시 문구. 작업 세션 바와 작업 관리의 관제 적용 상태가 같은 말을 쓴다. */
export const TEST_INPUT_LABEL = '녹화 재생 중 · 실제 알림 꺼짐';

/** 재생 중 표시를 올려 보면 나오는 설명. */
export const TEST_INPUT_TITLE =
  '현장 노트북이 실제 카메라 대신 녹화 파일(또는 합성 영상)을 보내고 있습니다. 위험 이벤트는 기록·화면 표시만 하고 현장 경보 소리·워치 진동은 보내지 않습니다.';

/** 재생 시험 알림 스위치가 켜진 채 재생 중일 때의 표시 문구(S15P31A101-736). */
export const REPLAY_TEST_ALERTS_LABEL = '재생 시험 · 실제 알림 켜짐';

/** 재생 시험 알림 표시를 올려 보면 나오는 설명. */
export const REPLAY_TEST_ALERTS_TITLE =
  '녹화 재생 리허설입니다. 재생 시험 알림 스위치(SIMAI_REPLAY_TEST_ALERTS)가 켜져 있어 재생 영상의 위험 이벤트도 워치 진동(현장 단말도 켜 두었다면 경보 소리)이 실제처럼 나갑니다. 본 시연(라이브) 전에 스위치를 끄세요.';

/** 지금 재생(시험 입력) 중인지. 모르면 false. 불리언이라 값이 바뀔 때만 다시 그린다. */
export function useTestInput(): boolean {
  return useRealtimeStore((s) => s.health?.payload.laptop.test_input === true);
}

/** EC2 재생 시험 알림 스위치가 켜져 있는지(S15P31A101-736). 모르면(이전 EC2) false. */
export function useReplayTestAlerts(): boolean {
  return useRealtimeStore((s) => s.health?.payload.laptop.replay_test_alerts === true);
}

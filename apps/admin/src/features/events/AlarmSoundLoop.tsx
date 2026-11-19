import { useAlarmSound } from '@/features/events/useAlarmSound';
import { useVisibleLiveEvents } from '@/features/events/useVisibleLiveEvents';

/**
 * 관제 앱 어느 화면에 있든 확인 대기 경보가 있으면 소리를 낸다. 그리는 것은 없다.
 * 모두 지운 경보는 소리도 멈춘다. 레이아웃이 이벤트마다 다시 그려지지 않게 따로 둔다.
 */
export function AlarmSoundLoop() {
  const { entries } = useVisibleLiveEvents();
  useAlarmSound(entries);
  return null;
}

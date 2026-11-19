import { useLiveEvents } from '@/features/events/useLiveEvents';
import { alarmCountsOf, type AlarmCounts } from '@/features/work/run/run';
import { useMemo } from 'react';

// 작업 종료 확인창·종료 뒤 요약이 같이 쓰는 위험 경보 수(S15P31A101-734). 서버가 준 이벤트 목록(관제와 같은 캐시)과 확인 기록으로 센다.
// 목록을 아직 못 받았으면(loaded false) 0건으로 보이지 않게 counts 를 null 로 둔다(0건과 모름을 가른다).

export interface RunAlarms {
  /** 이벤트 목록을 받아 센 수. 아직 못 받았으면 null. */
  counts: AlarmCounts | null;
  /** 목록을 받으려다 실패했다(다시 받는 중). */
  failed: boolean;
}

/** startedAt·endedAt 은 그 실행의 시작·종료(EC2 ms). 진행 중이면 endedAt 은 null. */
export function useRunAlarms(startedAt: number | null, endedAt: number | null = null): RunAlarms {
  const { entries, loaded, failed } = useLiveEvents();
  const counts = useMemo(
    () => (loaded ? alarmCountsOf(entries, startedAt, endedAt) : null),
    [loaded, entries, startedAt, endedAt],
  );
  return { counts, failed };
}

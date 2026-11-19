import type { TbmWorkUnit } from '@/features/tbm/types';
import { isSetupFinished } from '@/features/work/preflight/preflight';

// 실시간 관제의 "오늘 작업" 계산. 대기 화면이 지금 관제할 작업이 있는지 볼 때 쓴다.
// 서버가 준 값만 쓴다: 날짜(date)·상태(status)·진행(progress).

/** 오늘 작업: 오늘 날짜의 작업과, 날짜와 상관없이 지금 진행 중인 작업(어제 시작해 끝내지 않은 작업을 가리지 않는다). */
export function todayWorks(works: readonly TbmWorkUnit[], today: string): TbmWorkUnit[] {
  return works.filter((work) => work.date === today || work.status === 'IN_PROGRESS');
}

/**
 * 지금 관제할 작업(끝나지 않았고, 작업 중이거나 세팅을 마친 작업)이 있는지. 날짜를 열면 작업과 빈 보고서가 같이 생기므로
 * 예정 작업이 있다는 것만으로는 관제를 열지 않는다(세팅 전에는 보일 3D 가 없다).
 * 상태와 진행 값을 모르는 작업은 관제할 작업으로 보지 않는다(잠근 채로 둔다): 세팅이 끝났는지 알 수 없는 채로 빈 3D 를 여는 것보다 낫다.
 */
export const hasMonitorableWork = (works: readonly TbmWorkUnit[]): boolean =>
  works.some(
    (work) =>
      work.status !== 'DONE' &&
      (work.status === 'IN_PROGRESS' || isSetupFinished(work.progress ?? null)),
  );

/** 끝난 작업(종료·제출)인가. */
const isEndedWork = (work: TbmWorkUnit): boolean =>
  work.status === 'DONE' || work.progress === 'ENDED' || work.progress === 'SUBMITTED';

/** 대기 화면의 종류: 세팅이 끝나지 않음(setup) · 오늘 작업이 모두 끝남(ended). */
export type StandbyKind = 'setup' | 'ended';

/**
 * 오늘 작업으로 정하는 대기 화면. 관제할 작업이 있으면 null(대기 아님)이고, 오늘 작업이 있는데 모두 끝났으면 ended,
 * 그 밖(작업이 없거나 세팅 전인 작업이 남음)은 setup 이다.
 */
export function standbyKindOf(works: readonly TbmWorkUnit[]): StandbyKind | null {
  if (hasMonitorableWork(works)) return null;
  return works.length > 0 && works.every(isEndedWork) ? 'ended' : 'setup';
}

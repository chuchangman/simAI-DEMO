import {
  fetchWorkTasks,
  fetchWorkUnits,
  putDailyWorkUnit,
  WORK_DAY_POLL_MS,
} from '@/features/work/api';
import type { DayProgress, WorkDaysRange } from '@/features/work/types';
import { dayKind, stageIndexOf, stageOfProgress, type WorkStageId } from '@/features/work/workDay';
import { api } from '@/lib/api';
import { openDayKey, WORK_TASKS_KEY, workDaysKey } from '@/lib/queryKeys';
import { useQuery } from '@tanstack/react-query';

// 달력·날짜 화면의 작업 목록 훅.

/** 날짜 범위(양 끝 포함)의 작업 목록. 달력 월 칸의 칩과 지난 날짜 목록에 쓴다. */
export function useWorkDays(range: WorkDaysRange, enabled = true) {
  const query = useQuery({
    queryKey: workDaysKey(range.from, range.to),
    queryFn: ({ signal }) => fetchWorkUnits(api, range, signal),
    enabled,
  });
  return {
    data: query.data,
    pending: enabled && query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

/** 화면 단계(로컬)가 서버 progress 가 가리키는 단계보다 앞서 있나. 서버가 아직 못 따라온 이동이다. */
const isServerBehind = (progress: DayProgress | null | undefined, localStage: WorkStageId) =>
  stageIndexOf(stageOfProgress(progress ?? 'REPORT')) < stageIndexOf(localStage);

/**
 * 날짜 화면을 열 때 그 날의 작업과 빈 보고서를 만들거나 가져온다(PUT, 멱등). 오늘·예정인 날만 부르고 지난 날은 부르지 않는다
 * (그때는 `enabled` 가 꺼져 data 가 undefined 이고 `kind` 가 'past' 다. 지난 날은 `useWorkDays` 로 그 날 작업을 본다).
 * data 는 작업 항목이고 `reportId` 는 같이 만들어진 보고서 id 다. 단계는 data.progress 를 `stageOfProgress` 에 넣어 정한다.
 * 화면을 열 때마다 새로 받고(캐시가 낡았을 수 있다) 새로 받기 전의 캐시는 data 로 내주지 않는다(pending 이다).
 * 서버 progress 가 세팅 중(SETUP)이거나, 화면 단계(`localStage`)가 서버보다 앞서 있는 동안(세션을 만들었는데 아직 REPORT 인 때 등)
 * 은 SETUP → SETUP_DONE 을 잡으려고 3초마다 다시 받는다.
 */
export function useOpenDay(date: string, todayKey: string, localStage: WorkStageId = 'report') {
  const kind = dayKind(date, todayKey);
  const enabled = kind !== 'past';
  const query = useQuery({
    queryKey: openDayKey(date),
    queryFn: ({ signal }) => putDailyWorkUnit(api, date, signal),
    enabled,
    refetchOnMount: 'always',
    refetchInterval: (q) => {
      const progress = q.state.data?.progress;
      return progress === 'SETUP' || isServerBehind(progress, localStage)
        ? WORK_DAY_POLL_MS
        : false;
    },
  });
  const fresh = enabled && query.isFetchedAfterMount;
  const data = fresh ? query.data : undefined;
  return {
    kind,
    data,
    reportId: data?.tbm_report?.report_id ?? null,
    pending: enabled && !fresh,
    error: enabled ? query.error : null,
    refetch: query.refetch,
  };
}

/** 작업내용 항목(체크 7개). 서버가 정한 목록이라 자주 바뀌지 않아 다시 받지 않는다. */
export function useWorkTasks() {
  const query = useQuery({
    queryKey: WORK_TASKS_KEY,
    queryFn: ({ signal }) => fetchWorkTasks(api, signal),
    staleTime: Infinity,
  });
  return { data: query.data, pending: query.isPending, error: query.error };
}

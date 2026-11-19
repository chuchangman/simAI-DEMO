// 여러 기능 폴더가 함께 쓰는 서버 상태의 쿼리 키. 한 기능이 다른 기능의 캐시를 무효화할 때 그 폴더를 가져오지 않게 여기 둔다.

/** 히스토리 작업 목록(GET /api/work-units?days=). 작업을 시작·종료하면 다시 받는다. */
export const HISTORY_WORKS_KEY = ['history', 'works'] as const;

// 작업 관리 새 흐름(features/work)의 서버 상태. 설정 화면 등 다른 기능이 작업 캐시를 무효화할 때 features/work 를 가져오지 않게 여기 둔다.

/** 작업 관리 새 흐름의 모든 캐시. 한꺼번에 다시 받게 할 때 쓴다. */
export const WORK_KEY = ['work'] as const;

/** 달력 월 목록(GET /api/work-units?from=&to=) 전부. */
export const WORK_DAYS_KEY = [...WORK_KEY, 'days'] as const;
export const workDaysKey = (from: string, to: string) => [...WORK_DAYS_KEY, from, to] as const;

/** 날짜 화면을 열 때 만들거나 조회한 하루 작업(PUT /api/work-units/daily/{date}) 전부. */
export const WORK_OPEN_DAY_KEY = [...WORK_KEY, 'open-day'] as const;
export const openDayKey = (date: string) => [...WORK_OPEN_DAY_KEY, date] as const;

/** 작업 하나(GET /api/work-units/{id}). */
export const workUnitKey = (workId: string) => [...WORK_KEY, 'unit', workId] as const;

/** 작업의 보고서 최신 판과 판 목록(GET /api/reports/tbm?work_id=) 전부. */
export const WORK_REPORTS_KEY = [...WORK_KEY, 'reports'] as const;
export const workReportsKey = (workId: string) => [...WORK_REPORTS_KEY, workId] as const;

/** 보고서의 서명 목록(GET /api/reports/tbm/{id}/signatures). */
export const workSignaturesKey = (reportId: number) =>
  [...WORK_KEY, 'signatures', reportId] as const;

/** 작업내용 항목(GET /api/work-tasks). */
export const WORK_TASKS_KEY = [...WORK_KEY, 'tasks'] as const;

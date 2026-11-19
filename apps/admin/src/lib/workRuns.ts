import { z } from 'zod';

// 작업 실행(S15P31A101-696, 사용자 결정 2026-11-14 방식 B): 하루 작업 하나 안에서 「작업 시작 ~ 작업 종료」를 실행 1·2… 로 반복한다
// (리허설 뒤 본 시연). TBM·세팅은 하루 한 번이고 실행마다 시작·종료 시각·이벤트·녹화 구간·다시 보기가 따로다.
// 서버 작업 응답(GET /api/work-units)의 `runs` 를 작업 관리·관제·다시 보기가 같이 읽는다. 화면 없이 시험한다.

/** 실행 하나. 시각은 EC2 ms, 진행 중이면 ended_at 이 null. */
export const workRunSchema = z.object({
  run_no: z.number().int().positive(),
  started_at: z.number(),
  ended_at: z.number().nullable(),
});
export type WorkRun = z.infer<typeof workRunSchema>;

/**
 * 작업 응답의 `runs` 칸. 옛 서버(칸 없음)·형식이 틀린 값은 모름(undefined)이고, 그때는 actual_* 로 실행 1 을 만든다(`runsOf`).
 * 작업 하나가 틀린 실행 칸 때문에 목록에서 빠지지 않게 실패시키지 않는다.
 */
export const workRunsField = z.array(workRunSchema).optional().catch(undefined);

/** 실행을 읽을 작업의 칸. 시작·종료 시각은 숫자(ms)로 넘긴다. */
export interface RunSource {
  runs?: readonly WorkRun[] | null;
  startedAt: number | null;
  endedAt: number | null;
}

/**
 * 작업의 실행 목록(번호순). 서버가 준 runs 를 쓰고, 없으면(실행 표 전 서버) 작업 시작·종료 시각을 실행 1 로 본다.
 * 시작하지 않은 작업은 빈 배열이다.
 */
export function runsOf({ runs, startedAt, endedAt }: RunSource): WorkRun[] {
  if (runs && runs.length > 0) return [...runs].sort((a, b) => a.run_no - b.run_no);
  return startedAt === null ? [] : [{ run_no: 1, started_at: startedAt, ended_at: endedAt }];
}

/** 진행 중 실행(끝나지 않은 마지막 실행). 없으면 null. */
export function openRun(source: RunSource): WorkRun | null {
  const runs = runsOf(source);
  const last = runs[runs.length - 1];
  return last && last.ended_at === null ? last : null;
}

/** 마지막 실행(진행 중이든 끝났든). 시작 전이면 null. */
export function lastRun(source: RunSource): WorkRun | null {
  const runs = runsOf(source);
  return runs[runs.length - 1] ?? null;
}

/** 끝난 실행만(다시 보기·녹화 구간). */
export const endedRuns = (source: RunSource): WorkRun[] =>
  runsOf(source).filter((run) => run.ended_at !== null);

/** 실행 이름: '실행 1'. */
export const runLabel = (run: Pick<WorkRun, 'run_no'>): string => `실행 ${run.run_no}`;

/** 다음 실행 번호(「한 번 더 실행」). 시작 전이면 1. */
export const nextRunNo = (source: RunSource): number => (lastRun(source)?.run_no ?? 0) + 1;

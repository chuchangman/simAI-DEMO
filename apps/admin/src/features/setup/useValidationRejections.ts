import { pairLabel } from '@/features/setup/cameraLabels';
import { pairsInMessage } from '@/features/setup/setupFailures';
import type { SetupSessionResponse } from '@/features/setup/types';
import { useState } from 'react';

export interface ValidationAttempt {
  id: string;
  workId: number;
  pairs: [string, string][];
}

/** 끝난 시도만 두 개 남긴다. 진행 조회를 여러 번 받아도 거부 횟수는 늘지 않는다. */
export function recordValidationAttempt(
  history: readonly ValidationAttempt[],
  session: SetupSessionResponse | null,
  cameraIds: readonly string[],
): readonly ValidationAttempt[] {
  if (!session || !['FAILED', 'COMPLETED'].includes(session.status)) return history;
  if (history.some((h) => h.id === session.setup_session_id)) return history;
  return [
    ...history.filter((h) => h.workId === session.work_unit_id),
    {
      id: session.setup_session_id,
      workId: session.work_unit_id,
      pairs:
        session.failure_code === 'VALIDATION_REJECTED'
          ? pairsInMessage(session.failure_message ?? '', cameraIds)
          : [],
    },
  ].slice(-2);
}

export function repeatedValidationPairs(
  history: readonly ValidationAttempt[],
  ids: readonly string[],
) {
  const [before, current] = history;
  if (!before || !current || before.workId !== current.workId) return '';
  return current.pairs
    .filter(([a, b]) => before.pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x)))
    .map(([a, b]) => pairLabel(ids, a, b))
    .join(', ');
}

/** 이 세팅 화면에서 연속된 시도만 비교한다. 서버가 이력을 주지 않으므로 모르는 과거 횟수는 추정하지 않는다. */
export function useValidationRejections(
  session: SetupSessionResponse | null,
  ids: readonly string[],
) {
  const [history, setHistory] = useState<readonly ValidationAttempt[]>([]);
  const next = recordValidationAttempt(history, session, ids);
  if (next !== history) setHistory(next);
  return repeatedValidationPairs(next, ids);
}

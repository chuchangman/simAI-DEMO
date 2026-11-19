import { PlanOverlay } from '@/features/layout/spatialHost/PlanOverlay';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { todayIsoDate } from '@/features/tbm/taskInput';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 평면 그림(LivePlan)은 따로 시험하므로 자리표시자로 바꾼다.
vi.mock('@/features/plan/LivePlan', () => ({ LivePlan: () => <div data-testid="live-plan" /> }));

const work = (status: TbmWorkUnit['status'], progress: TbmWorkUnit['progress']): TbmWorkUnit => ({
  work_id: '1',
  status,
  progress,
  date: todayIsoDate(),
  name: '작업',
  from_ms: 1,
  to_ms: 2,
  zone_id: null,
  place: null,
  planned_people: 1,
  lead: null,
  layout_id: null,
  work_type: null,
});

/** works 가 있으면 오늘 작업 목록을 이미 받은 것으로 한다(대기 화면 여부를 캐시에서 읽는다). */
function renderOverlay(works?: TbmWorkUnit[]) {
  const client = new QueryClient();
  if (works) client.setQueryData(TBM_WORKS_KEY, works);
  render(
    <QueryClientProvider client={client}>
      <PlanOverlay withEventPanel selectedKey={null} onSelect={() => {}} />
    </QueryClientProvider>,
  );
  return screen.getByTestId('live-plan').parentElement!;
}

afterEach(cleanup);

describe('PlanOverlay', () => {
  it('지금 관제할 작업이 없어 대기 화면이 덮는 동안은 inert 다', () => {
    expect(renderOverlay([work('DONE', 'ENDED')]).hasAttribute('inert')).toBe(true);
    cleanup();
    expect(renderOverlay([work('PLANNED', 'REPORT')]).hasAttribute('inert')).toBe(true);
  });

  it('작업 목록을 받기 전이거나 세팅을 마친 작업이 있으면 inert 가 아니다', () => {
    expect(renderOverlay().hasAttribute('inert')).toBe(false);
    cleanup();
    expect(renderOverlay([work('PLANNED', 'SETUP_DONE')]).hasAttribute('inert')).toBe(false);
  });
});

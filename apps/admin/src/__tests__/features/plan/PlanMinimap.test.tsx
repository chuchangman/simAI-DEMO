import { PlanMinimap } from '@/features/plan/PlanMinimap';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { todayIsoDate } from '@/features/tbm/taskInput';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 3D 관제 왼쪽 칼럼 맨 아래에 고정된 작은 2D 지도: 누르면 큰 창이 뜨고, 옮기거나 크기를 바꿀 수 없다.
// 평면 그림(LivePlan)은 따로 시험하므로 자리표시자로 바꾼다.
vi.mock('@/features/plan/LivePlan', () => ({ LivePlan: () => <div data-testid="live-plan" /> }));

const opener = () => screen.getByRole('button', { name: '2D 평면 크게 보기' });

/** works 가 있으면 오늘 작업 목록을 이미 받은 것으로 한다(대기 화면 여부를 캐시에서 읽는다). */
function renderMinimap(works?: TbmWorkUnit[]) {
  const client = new QueryClient();
  if (works) client.setQueryData(TBM_WORKS_KEY, works);
  render(
    <QueryClientProvider client={client}>
      <PlanMinimap selectedKey={null} onSelect={() => {}} />
    </QueryClientProvider>,
  );
  return screen.getByTestId('plan-minimap');
}

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

afterEach(() => cleanup());

describe('PlanMinimap', () => {
  it('지금 관제할 작업이 없어 대기 화면이 덮는 동안은 inert 라 Tab 으로도 눌리지 않는다', () => {
    expect(renderMinimap([work('DONE', 'ENDED')]).hasAttribute('inert')).toBe(true);
    cleanup();
    expect(renderMinimap([work('PLANNED', 'REPORT')]).hasAttribute('inert')).toBe(true);
  });

  it('작업 목록을 받기 전이거나 세팅을 마친 작업이 있으면 inert 가 아니다', () => {
    expect(renderMinimap().hasAttribute('inert')).toBe(false);
    cleanup();
    expect(renderMinimap([work('PLANNED', 'SETUP_DONE')]).hasAttribute('inert')).toBe(false);
  });

  it('왼쪽 아래에 칼럼 폭의 정사각형으로 고정되고, 크기 조절 손잡이는 없다', () => {
    const minimap = renderMinimap();
    expect(minimap.className).toContain('bottom-3.5');
    expect(minimap.className).toContain('left-3.5');
    expect(minimap.className).toContain('size-(--minimap-size)');
    expect(minimap.getAttribute('style')).toBeNull();
    expect(minimap.querySelector('.cursor-nesw-resize')).toBeNull();
  });

  it('누르면 큰 2D 창이 열리고 Esc 로 닫힌다', () => {
    renderMinimap();
    expect(screen.queryByTestId('plan-modal')).toBeNull();
    fireEvent.click(opener());
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('끌어도 옮겨지지 않고, 끌고 놓은 뒤의 클릭은 큰 창을 연다', () => {
    const minimap = renderMinimap();
    fireEvent.pointerDown(minimap, { clientX: 100, clientY: 100, button: 0, buttons: 1 });
    fireEvent.pointerMove(minimap, { clientX: 400, clientY: 250, button: 0, buttons: 1 });
    fireEvent.pointerUp(minimap, { clientX: 400, clientY: 250, button: 0 });
    expect(minimap.getAttribute('style')).toBeNull();

    fireEvent.click(opener(), { detail: 1 });
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
  });
});

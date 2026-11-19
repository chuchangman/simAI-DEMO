import {
  useWorkAction,
  WorkActionProvider,
  type WorkActionConfig,
} from '@/features/work/WorkActionContext';
import { WorkActionLayer } from '@/features/work/WorkActionLayer';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

/** 단계 화면 자리: 받은 단추 줄을 등록한다. */
function Stage({ config }: { config: WorkActionConfig | null }) {
  useWorkAction(config);
  return null;
}

const next = (overrides: Partial<WorkActionConfig> = {}): WorkActionConfig => ({
  label: '다음',
  enabled: true,
  onClick: () => undefined,
  ...overrides,
});

function renderLayer(config: WorkActionConfig | null) {
  return render(
    <WorkActionProvider>
      <Stage config={config} />
      <WorkActionLayer />
    </WorkActionProvider>,
  );
}

describe('WorkActionLayer', () => {
  it('등록된 단추 줄이 없으면 아무것도 그리지 않는다', () => {
    renderLayer(null);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('group', { name: '작업 단추' })).toBeNull();
  });

  it('주 단추를 그리고 누르면 알린다', () => {
    const onClick = vi.fn();
    renderLayer(next({ label: '완료', onClick }));
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('보조 단추는 주 단추 왼쪽에 놓이고 각각 알린다', () => {
    const onBack = vi.fn();
    const onDelete = vi.fn();
    renderLayer(
      next({
        secondary: [
          { label: '이전', onClick: onBack },
          { label: '삭제', onClick: onDelete, kind: 'danger' },
        ],
      }),
    );
    const group = screen.getByRole('group', { name: '작업 단추' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['이전', '삭제', '다음']);
    fireEvent.click(screen.getByRole('button', { name: '이전' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('보조 단추의 disabled 가 켜지면 눌리지 않는다', () => {
    const onBack = vi.fn();
    const onDelete = vi.fn();
    renderLayer(
      next({
        secondary: [
          { label: '이전', onClick: onBack, disabled: true },
          { label: '삭제', onClick: onDelete },
        ],
      }),
    );
    const back = screen.getByRole('button', { name: '이전' }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '삭제' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(back);
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onBack).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('enabled 가 꺼지면 눌리지 않고, 이유(title)는 감싼 칸에 달려 마우스를 올리면 보인다', () => {
    const onClick = vi.fn();
    renderLayer(next({ enabled: false, onClick, title: '작업 날짜에 시작할 수 있어요' }));
    const button = screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTitle('작업 날짜에 시작할 수 있어요').contains(button)).toBe(true);
  });

  it('꺼진 이유(reason)는 마우스를 올리지 않아도 단추 왼쪽에 늘 보이고, 없으면 그리지 않는다(-734)', () => {
    const view = renderLayer(next({ enabled: false, reason: '종료 미팅 작성 중이에요' }));
    const group = screen.getByRole('group', { name: '작업 단추' });
    const reason = within(group).getByRole('status');
    expect(reason.textContent).toBe('종료 미팅 작성 중이에요');
    const button = within(group).getByRole('button', { name: '다음' });
    expect(reason.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(
      <WorkActionProvider>
        <Stage config={next()} />
        <WorkActionLayer />
      </WorkActionProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('요청 중(pending)이면 눌리지 않고 진행 중으로 표시한다', () => {
    const onClick = vi.fn();
    renderLayer(next({ pending: true, onClick }));
    const button = screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('단추 줄이 다시 등록되면 새 단추가 보인다', () => {
    const view = renderLayer(next({ label: '다음' }));
    expect(screen.getByRole('button', { name: '다음' })).toBeTruthy();
    view.rerender(
      <WorkActionProvider>
        <Stage config={next({ label: '완료' })} />
        <WorkActionLayer />
      </WorkActionProvider>,
    );
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull();
    expect(screen.getByRole('button', { name: '완료' })).toBeTruthy();
  });

  it('본문(<main>) 안에서 그려도 하단 메뉴가 뜨는 층(<main> 의 부모)에 얹힌다', () => {
    render(
      <div data-testid="stage">
        <main data-testid="main">
          <WorkActionProvider>
            <Stage config={next()} />
            <WorkActionLayer />
          </WorkActionProvider>
        </main>
      </div>,
    );
    const group = screen.getByRole('group', { name: '작업 단추' });
    expect(screen.getByTestId('main').contains(group)).toBe(false);
    expect(screen.getByTestId('stage').contains(group)).toBe(true);
  });
});

import {
  useWorkAction,
  useWorkActionState,
  WorkActionProvider,
  type WorkActionConfig,
} from '@/features/work/WorkActionContext';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

function Layer({ onRender }: { onRender?: () => void } = {}) {
  const config = useWorkActionState();
  onRender?.();
  return (
    <div>
      <span data-testid="label">{config ? config.label : '없음'}</span>
      <span data-testid="enabled">{String(config?.enabled ?? null)}</span>
      <span data-testid="secondary">{config?.secondary?.map((s) => s.label).join(',') ?? ''}</span>
      <button type="button" onClick={() => config?.onClick()}>
        눌러
      </button>
      <button type="button" onClick={() => config?.secondary?.[0]?.onClick()}>
        보조 눌러
      </button>
      <span data-testid="secondary-disabled">
        {String(config?.secondary?.[0]?.disabled ?? null)}
      </span>
    </div>
  );
}

const next = (overrides: Partial<WorkActionConfig> = {}): WorkActionConfig => ({
  label: '다음',
  enabled: true,
  onClick: () => undefined,
  ...overrides,
});

/** 스스로 다시 그리는 단계 화면: 렌더마다 새 객체·새 함수를 넘기되 겉모양은 같고, 누르는 동작만 그때의 count 를 담는다. */
function RedrawStage({ calls }: { calls: string[] }) {
  const [count, setCount] = useState(0);
  useWorkAction({
    label: '다음',
    enabled: true,
    onClick: () => calls.push(`주 ${count}`),
    secondary: [{ label: '이전', onClick: () => calls.push(`보조 ${count}`) }],
  });
  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      다시 그리기
    </button>
  );
}

describe('WorkActionContext', () => {
  it('단계 화면이 등록한 단추 줄을 레이어가 읽는다', () => {
    function Stage() {
      useWorkAction(next({ secondary: [{ label: '건너뛰기', onClick: () => undefined }] }));
      return null;
    }
    render(
      <WorkActionProvider>
        <Stage />
        <Layer />
      </WorkActionProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('다음');
    expect(screen.getByTestId('enabled').textContent).toBe('true');
    expect(screen.getByTestId('secondary').textContent).toBe('건너뛰기');
  });

  it('등록하지 않았으면 단추 줄이 없다', () => {
    render(
      <WorkActionProvider>
        <Layer />
      </WorkActionProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('없음');
  });

  it('화면이 사라지면 해제되고 다음 화면이 등록한 것으로 바뀐다', () => {
    function Report() {
      useWorkAction(next({ label: '다음' }));
      return null;
    }
    function Run() {
      useWorkAction(next({ label: '완료' }));
      return null;
    }
    function Host({ stage }: { stage: 'report' | 'run' | 'none' }) {
      return (
        <WorkActionProvider>
          {stage === 'report' ? <Report /> : stage === 'run' ? <Run /> : null}
          <Layer />
        </WorkActionProvider>
      );
    }
    const view = render(<Host stage="report" />);
    expect(screen.getByTestId('label').textContent).toBe('다음');
    view.rerender(<Host stage="run" />);
    expect(screen.getByTestId('label').textContent).toBe('완료');
    view.rerender(<Host stage="none" />);
    expect(screen.getByTestId('label').textContent).toBe('없음');
  });

  it('null 을 넘기면 단추를 숨긴다', () => {
    function Stage({ show }: { show: boolean }) {
      useWorkAction(show ? next() : null);
      return null;
    }
    const view = render(
      <WorkActionProvider>
        <Stage show />
        <Layer />
      </WorkActionProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('다음');
    view.rerender(
      <WorkActionProvider>
        <Stage show={false} />
        <Layer />
      </WorkActionProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('없음');
  });

  it('렌더마다 새로 불러도 가장 최근 onClick·활성 값이 쓰인다', () => {
    const calls: number[] = [];
    function Stage() {
      const [count, setCount] = useState(0);
      useWorkAction(
        next({
          enabled: count < 2,
          onClick: () => {
            calls.push(count);
            setCount((n) => n + 1);
          },
        }),
      );
      return null;
    }
    render(
      <WorkActionProvider>
        <Stage />
        <Layer />
      </WorkActionProvider>,
    );
    const press = screen.getByRole('button', { name: '눌러' });
    act(() => press.click());
    act(() => press.click());
    expect(calls).toEqual([0, 1]);
    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('등록해도 등록한 단계 화면은 다시 그려지지 않는다', () => {
    const rendered = vi.fn();
    const config = next();
    function Stage() {
      rendered();
      useWorkAction(config);
      return null;
    }
    render(
      <WorkActionProvider>
        <Stage />
        <Layer />
      </WorkActionProvider>,
    );
    expect(screen.getByTestId('label').textContent).toBe('다음');
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  describe('겉모양이 같으면 다시 등록하지 않는다', () => {
    it('단계 화면이 다시 그려져도 레이어는 다시 그려지지 않고, 누르면 최신 onClick 이 불린다', () => {
      const layerRendered = vi.fn();
      const calls: string[] = [];
      // 레이어는 단계 화면의 형제라 단계 화면이 다시 그려져도 등록이 바뀔 때만 다시 그려진다.
      render(
        <WorkActionProvider>
          <RedrawStage calls={calls} />
          <Layer onRender={layerRendered} />
        </WorkActionProvider>,
      );
      const before = layerRendered.mock.calls.length;
      const redraw = screen.getByRole('button', { name: '다시 그리기' });
      act(() => redraw.click());
      act(() => redraw.click());
      expect(layerRendered).toHaveBeenCalledTimes(before);

      act(() => screen.getByRole('button', { name: '눌러' }).click());
      act(() => screen.getByRole('button', { name: '보조 눌러' }).click());
      expect(calls).toEqual(['주 2', '보조 2']);
    });

    it('글자·켜짐·보조 단추 꺼짐이 바뀌면 다시 등록한다', () => {
      function Stage({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
        useWorkAction(
          next({ enabled, secondary: [{ label: '이전', onClick: () => undefined, disabled }] }),
        );
        return null;
      }
      const view = render(
        <WorkActionProvider>
          <Stage enabled disabled={false} />
          <Layer />
        </WorkActionProvider>,
      );
      expect(screen.getByTestId('enabled').textContent).toBe('true');
      expect(screen.getByTestId('secondary-disabled').textContent).toBe('false');
      view.rerender(
        <WorkActionProvider>
          <Stage enabled={false} disabled />
          <Layer />
        </WorkActionProvider>,
      );
      expect(screen.getByTestId('enabled').textContent).toBe('false');
      expect(screen.getByTestId('secondary-disabled').textContent).toBe('true');
    });
  });
});

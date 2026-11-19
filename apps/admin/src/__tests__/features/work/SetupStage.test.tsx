import { SAMPLE_DATE, workDayOf } from '@/__tests__/features/work/workFixture';
import type { SetupPageProps } from '@/features/setup/SetupPage';
import { SetupStage } from '@/features/work/SetupStage';
import { cleanup, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 세팅 화면 자체(SetupPage)는 features/setup 시험이 본다. 여기서는 날짜 화면이 넘긴 값이 맞게 전달되는지만 본다.
const received = vi.hoisted(() => ({ props: [] as unknown[], mounted: 0 }));
vi.mock('@/features/setup/SetupPage', () => ({
  SetupPage: (props: SetupPageProps) => {
    received.props.push(props);
    useEffect(() => {
      received.mounted += 1;
    }, []);
    return <div data-testid="setup-page" />;
  },
}));

afterEach(() => {
  cleanup();
  received.props.length = 0;
  received.mounted = 0;
});

const lastProps = () => received.props.at(-1) as SetupPageProps;

describe('SetupStage', () => {
  it('날짜 화면 안에 세팅을 끼워 보이고 작업 id 를 숫자로 넘긴다', () => {
    render(
      <SetupStage
        day={workDayOf({ work_id: '9002' })}
        date={SAMPLE_DATE}
        todayKey={SAMPLE_DATE}
        onNext={() => undefined}
      />,
    );
    expect(screen.getByTestId('setup-page')).toBeTruthy();
    expect(lastProps()).toMatchObject({ workUnitId: 9002, embedded: true });
  });

  it('구역 단계가 끝나면 날짜 화면의 onNext 가 불린다', () => {
    const onNext = vi.fn();
    render(
      <SetupStage day={workDayOf()} date={SAMPLE_DATE} todayKey={SAMPLE_DATE} onNext={onNext} />,
    );
    lastProps().onDone?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('다른 작업으로 바뀌면 세팅 화면을 새로 연다', () => {
    const props = { date: SAMPLE_DATE, todayKey: SAMPLE_DATE, onNext: () => undefined };
    const { rerender } = render(<SetupStage day={workDayOf({ work_id: '9001' })} {...props} />);
    rerender(<SetupStage day={workDayOf({ work_id: '9001', name: '바뀐 이름' })} {...props} />);
    expect(received.mounted).toBe(1);
    rerender(<SetupStage day={workDayOf({ work_id: '9002' })} {...props} />);
    expect(received.mounted).toBe(2);
    expect(lastProps().workUnitId).toBe(9002);
  });
});

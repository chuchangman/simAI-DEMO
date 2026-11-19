import {
  installReportServer,
  latestReport,
  openDay,
  renderWithClient,
  T0,
  TODAY,
  TOMORROW,
} from '@/__tests__/features/work/report/reportHarness';
import { saveReportForm } from '@/features/work/api';
import { ReportStage } from '@/features/work/report/ReportStage';
import { blankReportForm } from '@/features/work/reportForm';
import type { WorkDayItem } from '@/features/work/types';
import { useWorkActionState, WorkActionProvider } from '@/features/work/WorkActionContext';
import { api } from '@/lib/api';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 단계 1 'TBM 보고서'. 단추 줄은 WorkActionProvider 로 감싸고 useWorkActionState 로 읽는다(날짜 화면의 단추 줄과 같은 방식).

installReportServer();
const EDIT = { name: 'TBM 보고서 편집' };
const FUTURE_TITLE = '작업 날짜에 시작할 수 있어요';

/** 등록된 단추 줄을 그대로 그린다(날짜 화면의 WorkActionLayer 를 흉내 낸다). */
function ActionProbe({ onRender }: { onRender?: () => void } = {}) {
  const config = useWorkActionState();
  onRender?.();
  if (!config) return null;
  return (
    <button type="button" disabled={!config.enabled} title={config.title} onClick={config.onClick}>
      {config.label}
    </button>
  );
}

function renderStage(day: WorkDayItem, date = day.date, todayKey = TODAY) {
  const onNext = vi.fn();
  const view = renderWithClient(
    <WorkActionProvider>
      <ReportStage day={day} date={date} todayKey={todayKey} onNext={onNext} />
      <ActionProbe />
    </WorkActionProvider>,
  );
  return { onNext, ...view };
}

const next = () => screen.getByRole('button', { name: '다음' }) as HTMLButtonElement;

/** 작업내용을 미리 정해 둔다. */
async function saveTasks(workId: string, codes: string[]) {
  const report = await latestReport(workId);
  await saveReportForm(api, report.report_id, {
    form: {
      ...blankReportForm(T0),
      info: { ...blankReportForm(T0).info, tasks: codes.map((code) => ({ code })) },
    },
    form_revision: report.form_revision,
  });
}

describe('오늘', () => {
  it('왼쪽에 보고서 종이와 출력 단추가 있고, 보고서를 받기 전에는 다음 이 꺼져 있다', async () => {
    const day = await openDay();
    renderStage(day);
    expect(screen.getByText('TBM(작업 전 안전대화) 보고서')).toBeTruthy();
    expect(screen.getByRole('button', { name: '출력' })).toBeTruthy();
    expect(next().disabled).toBe(true);
    await screen.findByRole('button', EDIT);
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(next().title).toBe('');
  });

  it('만들기 단추나 진행 막대는 없다', async () => {
    const day = await openDay();
    renderStage(day);
    await screen.findByRole('button', EDIT);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button', { name: /만들기|생성/ })).toBeNull();
  });

  it('작업내용이 있으면 다음 이 바로 다음 단계로 보낸다(창 없음)', async () => {
    const day = await openDay();
    await saveTasks(day.work_id, ['REBAR']);
    const { onNext } = renderStage(day);
    await waitFor(() => expect(next().disabled).toBe(false));
    await screen.findByText('• 철근 배근');
    fireEvent.click(next());
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', EDIT)).toBeNull();
  });

  it('작업내용이 비었으면 다음 이 저장하고 세팅 시작 창을 연다', async () => {
    const day = await openDay();
    const { onNext } = renderStage(day);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());

    expect(await screen.findByRole('dialog', EDIT)).toBeTruthy();
    expect(screen.getByRole('button', { name: '저장하고 세팅 시작' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('그래도 비면 빨간 윤곽으로 알리고 창을 유지하며, 고르고 저장하면 저장 뒤 다음 단계로 간다', async () => {
    const day = await openDay();
    const { onNext } = renderStage(day);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole('checkbox', { name: '철근 배근' });

    fireEvent.click(screen.getByRole('button', { name: '저장하고 세팅 시작' }));
    expect(screen.getByRole('group', { name: '작업내용' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(screen.getByRole('dialog', EDIT)).toBeTruthy();
    expect(onNext).not.toHaveBeenCalled();
    expect((await latestReport(day.work_id)).form?.info.tasks).toEqual([]);

    fireEvent.click(screen.getByRole('checkbox', { name: '철근 배근' }));
    fireEvent.click(screen.getByRole('button', { name: '저장하고 세팅 시작' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect((await latestReport(day.work_id)).form?.info.tasks).toEqual([{ code: 'REBAR' }]);
    await waitFor(() => expect(screen.queryByRole('dialog', EDIT)).toBeNull());
  });

  it('창을 취소하면 다음 단계로 가지 않고 다시 다음 을 눌러 열 수 있다', async () => {
    const day = await openDay();
    const { onNext } = renderStage(day);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole('dialog', EDIT);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', EDIT)).toBeNull());
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.click(next());
    expect(await screen.findByRole('dialog', EDIT)).toBeTruthy();
  });

  it('종이를 눌러 작업내용을 저장하면(일반 저장) 다음 단계로 가지 않는다', async () => {
    const day = await openDay();
    const { onNext } = renderStage(day);
    fireEvent.click(await screen.findByRole('button', EDIT));
    expect(await screen.findByRole('button', { name: '저장' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('checkbox', { name: '철근 배근' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장했습니다')).toBeTruthy();
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('예정인 날(미래)', () => {
  it('다음 은 꺼져 있고 이유를 title 로 알려 주며, 작업내용은 고르고 저장할 수 있다', async () => {
    const day = await openDay(TOMORROW);
    const { onNext } = renderStage(day, TOMORROW, TODAY);
    // 보고서를 받은 뒤에도 꺼져 있다.
    fireEvent.click(await screen.findByRole('button', EDIT));
    expect(next().disabled).toBe(true);
    expect(next().title).toBe(FUTURE_TITLE);

    fireEvent.click(await screen.findByRole('checkbox', { name: '철근 배근' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장했습니다')).toBeTruthy();
    expect((await latestReport(day.work_id)).form?.info.tasks).toEqual([{ code: 'REBAR' }]);

    // 작업내용이 있어도 꺼져 있고 눌러도 아무 일이 없다.
    expect(next().disabled).toBe(true);
    fireEvent.click(next());
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', EDIT)).toBeNull();
  });

  it('보고서를 받기 전에도 같은 이유를 보인다', async () => {
    const day = await openDay(TOMORROW);
    renderStage(day, TOMORROW, TODAY);
    expect(next().disabled).toBe(true);
    expect(next().title).toBe(FUTURE_TITLE);
  });
});

describe('단추 줄 등록', () => {
  it('단계 화면이 다시 그려져도 입력이 같으면 단추 줄을 다시 등록하지 않는다', async () => {
    const day = await openDay();
    const probeRendered = vi.fn();
    const onNext = vi.fn();
    // 단계 화면만 다시 그리는 부모. 단추 줄 읽는 쪽(ActionProbe)은 형제라 등록이 바뀔 때만 다시 그려진다.
    function Stage() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setCount((n) => n + 1)}>
            {`다시 그리기 ${count}`}
          </button>
          <ReportStage day={day} date={day.date} todayKey={TODAY} onNext={onNext} />
        </>
      );
    }
    renderWithClient(
      <WorkActionProvider>
        <Stage />
        <ActionProbe onRender={probeRendered} />
      </WorkActionProvider>,
    );
    await waitFor(() => expect(next().disabled).toBe(false));
    await screen.findByRole('button', EDIT);

    const before = probeRendered.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '다시 그리기 0' }));
    fireEvent.click(screen.getByRole('button', { name: '다시 그리기 1' }));
    expect(screen.getByRole('button', { name: '다시 그리기 2' })).toBeTruthy();
    expect(probeRendered).toHaveBeenCalledTimes(before);
  });
});

import {
  DRAFT_DELAY_MS,
  endDay,
  installReportServer,
  latestReport,
  openDay,
  renderWithClient,
  T0,
} from '@/__tests__/features/work/report/reportHarness';
import { fetchReportsByWork, saveReportForm, submitReport, WORK_ERROR } from '@/features/work/api';
import { ReportEditDialog } from '@/features/work/report/ReportEditDialog';
import { blankReportForm } from '@/features/work/reportForm';
import type { WorkReport } from '@/features/work/types';
import { api } from '@/lib/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 보고서 요청 함수는 그대로 쓰되 몇 번 불렸는지 본다.
vi.mock('@/features/work/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/work/api')>();
  return { ...actual, fetchReportsByWork: vi.fn(actual.fetchReportsByWork) };
});

// 보고서 편집 창을 작업 관리 mock 에 붙여 본다(저장은 실제 요청 함수로 mock 까지 간다).

const server = installReportServer();
const DIALOG = { name: 'TBM 보고서 편집' };

/** 날짜를 열어 둔 초안 전 보고서. */
async function blankReport(): Promise<WorkReport> {
  const day = await openDay();
  return latestReport(day.work_id);
}

/** 세팅이 끝나 초안이 채워진 보고서. */
async function draftedReport(): Promise<WorkReport> {
  const day = await openDay();
  server.mock.markSetupDone(day.work_id);
  server.clock += DRAFT_DELAY_MS;
  return latestReport(day.work_id);
}

const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const radios = (group: string) => within(screen.getByRole('radiogroup', { name: group }));

describe('초안 전: 작업내용만', () => {
  it('작업내용 7개와 기타만 보이고 다른 칸은 없다', async () => {
    const report = await blankReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('dialog', DIALOG);
    expect(screen.getByText('TBM 보고서 편집', { selector: 'h2' })).toBeTruthy();

    await screen.findByRole('checkbox', { name: '철근 배근' });
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(checkbox('슬래브 개구부 덮개 설치')).toBeTruthy();
    expect(checkbox('기타')).toBeTruthy();
    expect(screen.getByLabelText('기타 작업내용')).toBeTruthy();
    expect(screen.queryByText('잠재위험과 대책')).toBeNull();
    expect(screen.queryByText('안전조치 확인')).toBeNull();
    expect(screen.queryByLabelText('장소')).toBeNull();
    expect(screen.getByRole('button', { name: '취소' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });

  it('기타 칸에 글을 쓰면 체크가 켜진다', async () => {
    const report = await blankReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    expect(checkbox('기타').checked).toBe(false);
    fireEvent.change(screen.getByLabelText('기타 작업내용'), { target: { value: '조적' } });
    expect(checkbox('기타').checked).toBe(true);
  });

  it('기타 체크를 켜면 글 칸으로 커서가 간다', async () => {
    const report = await blankReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    fireEvent.click(checkbox('기타'));
    expect(document.activeElement).toBe(screen.getByLabelText('기타 작업내용'));
  });

  it('기타 글은 서버 한도(100자)까지만 받는다', async () => {
    const report = await blankReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    expect(screen.getByLabelText('기타 작업내용').getAttribute('maxlength')).toBe('100');
  });

  it('저장하면 고른 작업내용이 서버에 저장되고 창이 닫힌다', async () => {
    const report = await blankReport();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithClient(<ReportEditDialog report={report} onSaved={onSaved} onClose={onClose} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(checkbox('거푸집 설치·해체'));
    fireEvent.change(screen.getByLabelText('기타 작업내용'), { target: { value: '조적' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    const saved = await latestReport(report.work_id);
    expect(saved.form?.info.tasks).toEqual([
      { code: 'FORMWORK' },
      { code: 'REBAR' },
      { text: '조적' },
    ]);
    expect(saved.form?.info.task_name).toBe('거푸집 설치·해체 외 2건');
    expect(saved.form_revision).toBe(report.form_revision + 1);
  });

  it('취소하면 저장하지 않고 닫는다', async () => {
    const report = await blankReport();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithClient(<ReportEditDialog report={report} onSaved={onSaved} onClose={onClose} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect((await latestReport(report.work_id)).form_revision).toBe(report.form_revision);
  });

  it('필수 모드: 작업내용이 비면 저장하지 않고 빨간 윤곽으로 알리며 창을 유지하고, 고르면 풀린다', async () => {
    const report = await blankReport();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithClient(
      <ReportEditDialog
        report={report}
        submitLabel="저장하고 세팅 시작"
        requireTasks
        onSaved={onSaved}
        onClose={onClose}
      />,
    );
    await screen.findByRole('checkbox', { name: '철근 배근' });
    fireEvent.click(screen.getByRole('button', { name: '저장하고 세팅 시작' }));
    const group = screen.getByRole('group', { name: '작업내용' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(checkbox('슬래브 개구부 덮개 설치'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', DIALOG)).toBeTruthy();
    expect((await latestReport(report.work_id)).form_revision).toBe(report.form_revision);

    fireEvent.click(checkbox('철근 배근'));
    expect(group.getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '저장하고 세팅 시작' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((await latestReport(report.work_id)).form?.info.tasks).toEqual([{ code: 'REBAR' }]);
  });

  it('글자 없는 기타 체크는 작업내용으로 치지 않는다', async () => {
    const report = await blankReport();
    const onSaved = vi.fn();
    renderWithClient(
      <ReportEditDialog report={report} requireTasks onSaved={onSaved} onClose={vi.fn()} />,
    );
    await screen.findByRole('checkbox', { name: '철근 배근' });
    fireEvent.click(checkbox('기타'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('group', { name: '작업내용' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('이미 고른 작업내용이 체크돼 있고, 저장한 직접 쓴 글은 기타 칸에 돌아온다', async () => {
    const report = await blankReport();
    await saveReportForm(api, report.report_id, {
      form: {
        ...blankReportForm(T0),
        info: { ...blankReportForm(T0).info, tasks: [{ code: 'REBAR' }, { text: '조적' }] },
      },
      form_revision: report.form_revision,
    });
    renderWithClient(
      <ReportEditDialog report={await latestReport(report.work_id)} onClose={vi.fn()} />,
    );
    await screen.findByRole('checkbox', { name: '철근 배근' });
    expect(checkbox('철근 배근').checked).toBe(true);
    expect(checkbox('거푸집 설치·해체').checked).toBe(false);
    expect(checkbox('기타').checked).toBe(true);
    expect((screen.getByLabelText('기타 작업내용') as HTMLInputElement).value).toBe('조적');
  });
});

describe('초안 후: 모든 칸', () => {
  it('정보·잠재위험·중점·안전조치·점검 칸이 넓은 창에 나오고 리더 칸은 없다', async () => {
    const report = await draftedReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('dialog', DIALOG);
    for (const title of ['정보', '잠재위험과 대책', '중점위험과 대책', '안전조치 확인']) {
      expect(screen.getByText(title, { selector: 'h3' })).toBeTruthy();
    }
    expect(screen.getByText('일일 안전점검 · 종료 미팅', { selector: 'h3' })).toBeTruthy();
    for (const label of [
      '일시',
      '장소',
      '작업명',
      '중점위험',
      '중점대책',
      '일일 안전점검',
      '종료 미팅',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText('잠재위험 ①')).toBeTruthy();
    expect(screen.getByLabelText('대책 ③')).toBeTruthy();
    expect(screen.getByRole('group', { name: '작업내용' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '작업일 동일 여부' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: '위험성평가 여부' })).toBeTruthy();
    for (const label of ['리더 소속', '직책', '성명']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    // 서버가 채운 값이 들어 있다
    expect((screen.getByLabelText('장소') as HTMLInputElement).value).toBe(report.form!.info.place);
    expect((screen.getByLabelText('일시') as HTMLInputElement).value).toBe('2026-11-11T09:00');
  });

  it('점검 5줄은 서버 문구로 보이고, 조치 내용 칸은 아니오일 때만 나온다', async () => {
    const report = await draftedReport();
    const checks = report.form!.checks;
    expect(checks.map((c) => c.yes)).toEqual([true, true, false, true, true]);
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('dialog', DIALOG);
    for (const row of checks)
      expect(screen.getByRole('radiogroup', { name: row.label })).toBeTruthy();
    expect(screen.getAllByLabelText('조치 내용')).toHaveLength(1);

    fireEvent.click(radios(checks[0]!.label).getByRole('radio', { name: '아니오' }));
    expect(screen.getAllByLabelText('조치 내용')).toHaveLength(2);
    fireEvent.click(radios(checks[2]!.label).getByRole('radio', { name: '예' }));
    expect(screen.getAllByLabelText('조치 내용')).toHaveLength(1);
  });

  it('고친 칸이 서버에 저장되고 예로 바꾼 줄의 조치 내용은 비워진다', async () => {
    const report = await draftedReport();
    const checks = report.form!.checks;
    const onSaved = vi.fn();
    renderWithClient(<ReportEditDialog report={report} onSaved={onSaved} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });

    fireEvent.change(screen.getByLabelText('장소'), { target: { value: '  3층 슬래브  ' } });
    fireEvent.change(screen.getByLabelText('잠재위험 ③'), { target: { value: '낙하물' } });
    fireEvent.change(screen.getByLabelText('대책 ③'), { target: { value: '방호망' } });
    fireEvent.change(screen.getByLabelText('종료 미팅'), { target: { value: '이상 없음' } });
    fireEvent.click(radios('위험성평가 여부').getByRole('radio', { name: '아니오' }));
    fireEvent.click(radios(checks[2]!.label).getByRole('radio', { name: '예' }));
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved = (await latestReport(report.work_id)).form!;
    expect(saved.info).toMatchObject({ place: '3층 슬래브', risk_assessed: false });
    expect(saved.info.tasks).toEqual([{ code: 'REBAR' }]);
    expect(saved.risks[2]).toEqual({ risk: '낙하물', measure: '방호망' });
    expect(saved.review.ending).toBe('이상 없음');
    expect(saved.checks[2]).toMatchObject({ yes: true, action: '' });
    // 작업내용을 처음 고른 저장이라 일시(서버가 넣은 작업 생성 시각)가 TBM 을 쓴 시각(지금)으로 바뀐다(-734).
    expect(report.form!.info.tasks).toEqual([]);
    expect(saved.info.date_time_ms).not.toBe(report.form!.info.date_time_ms);
    expect(Math.abs((saved.info.date_time_ms ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  it('입력 한도는 서버 한도와 같다', async () => {
    const report = await draftedReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('dialog', DIALOG);
    const max = (label: string) => screen.getByLabelText(label).getAttribute('maxlength');
    expect(max('장소')).toBe('200');
    expect(max('작업명')).toBe('100');
    expect(max('잠재위험 ①')).toBe('500');
    expect(max('중점대책')).toBe('500');
    expect(max('일일 안전점검')).toBe('2000');
    expect(max('종료 미팅')).toBe('2000');
  });
});

describe('저장 실패', () => {
  it('다른 곳에서 먼저 고쳤으면(REPORT_FORM_CONFLICT) 보고서를 다시 받아 알리고 그 내용으로 창을 새로 채운다', async () => {
    const report = await blankReport();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderWithClient(<ReportEditDialog report={report} onSaved={onSaved} onClose={onClose} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });

    // 다른 곳에서 먼저 저장했다(revision 이 올라간다).
    await saveReportForm(api, report.report_id, {
      form: {
        ...blankReportForm(T0),
        info: { ...blankReportForm(T0).info, tasks: [{ code: 'FORMWORK' }] },
      },
      form_revision: report.form_revision,
    });
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '다른 곳에서 먼저 고쳐서 최신 내용을 다시 불러왔습니다',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 내 입력은 버리고 최신 내용(거푸집)으로 채워졌다.
    await waitFor(() => expect(checkbox('거푸집 설치·해체').checked).toBe(true));
    expect(checkbox('철근 배근').checked).toBe(false);

    // 이제 최신 revision 으로 저장된다.
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect((await latestReport(report.work_id)).form?.info.tasks).toEqual([
      { code: 'FORMWORK' },
      { code: 'REBAR' },
    ]);
  });

  it('충돌로 보고서를 다시 받을 때 같은 요청이 두 번 나가지 않는다', async () => {
    const report = await blankReport();
    const reportRequests = vi.mocked(fetchReportsByWork);
    reportRequests.mockClear();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    // 창을 연 뒤 처음 받는 한 번.
    await waitFor(() => expect(reportRequests).toHaveBeenCalledTimes(1));

    await saveReportForm(api, report.report_id, {
      form: {
        ...blankReportForm(T0),
        info: { ...blankReportForm(T0).info, tasks: [{ code: 'FORMWORK' }] },
      },
      form_revision: report.form_revision,
    });
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(checkbox('거푸집 설치·해체').checked).toBe(true));

    // 충돌 처리가 보고서를 다시 받은 것은 한 번이다(중간에 취소된 요청도 센다).
    expect(reportRequests).toHaveBeenCalledTimes(2);
  });

  it('새 판이 생겼다는 거절(REPORT_VERSION_STALE)이면 보고서를 다시 받아 알린다', async () => {
    const day = await openDay();
    const first = await latestReport(day.work_id);
    renderWithClient(<ReportEditDialog report={first} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });

    // 그 사이 초안이 끝나고 종료 미팅까지 채워졌다. 날짜 작업은 새 판이 안 생기므로 서버가 새 판이 있다고 거절하는 응답만 흉내 낸다.
    await endDay(server, day.work_id);
    server.server.use(
      http.put(
        '*/api/reports/tbm/:id/form',
        () =>
          HttpResponse.json(
            { code: WORK_ERROR.REPORT_VERSION_STALE, message: '새 보고서 버전이 있습니다' },
            { status: 409 },
          ),
        { once: true },
      ),
    );
    fireEvent.click(checkbox('철근 배근'));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      '다른 곳에서 먼저 고쳐서 최신 내용을 다시 불러왔습니다',
    );
    // 다시 받은 보고서는 초안이 끝난 판이라 창이 넓은 모양으로 바뀐다.
    expect(await screen.findByLabelText('종료 미팅')).toBeTruthy();
    expect((screen.getByLabelText('종료 미팅') as HTMLTextAreaElement).value).toContain(
      '작업 종료',
    );
  });

  it('제출해 잠겼으면(REPORT_LOCKED) 읽기 전용이 되고 저장 단추가 사라진다', async () => {
    const day = await openDay();
    const ended = await endDay(server, day.work_id);
    const onSaved = vi.fn();
    renderWithClient(<ReportEditDialog report={ended} onSaved={onSaved} onClose={vi.fn()} />);
    await screen.findByLabelText('종료 미팅');

    // 창을 연 뒤에 다른 곳에서 제출했다.
    await submitReport(api, ended.report_id);
    fireEvent.change(screen.getByLabelText('장소'), { target: { value: '다른 곳' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect((await screen.findByRole('alert')).textContent).toBe('제출한 보고서는 고칠 수 없습니다');
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy();
    // 읽기 전용: 칸이 모두 잠긴다(fieldset 이 막은 칸은 :disabled 로 본다).
    expect(screen.getByLabelText('장소').matches(':disabled')).toBe(true);
    expect(checkbox('철근 배근').matches(':disabled')).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('그 밖의 실패는 저장하지 못했다고 알리고 창을 유지한다', async () => {
    const report = await blankReport();
    renderWithClient(<ReportEditDialog report={report} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '철근 배근' });
    // 서버가 받지 않는 글(100자 초과)을 강제로 넣는다.
    const input = screen.getByLabelText('기타 작업내용') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '가'.repeat(101) } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((await screen.findByRole('alert')).textContent).toBe('저장하지 못했습니다');
    expect(screen.getByRole('dialog', DIALOG)).toBeTruthy();
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });
});

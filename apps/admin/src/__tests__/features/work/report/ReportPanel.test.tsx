import {
  DRAFT_DELAY_MS,
  installReportServer,
  latestReport,
  openDay,
  renderWithClient,
  requestEnd,
  signAs,
  submitDay,
  T0,
} from '@/__tests__/features/work/report/reportHarness';
import { saveReportForm } from '@/features/work/api';
import { ReportPanel } from '@/features/work/report/ReportPanel';
import { blankReportForm } from '@/features/work/reportForm';
import { api } from '@/lib/api';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 보고서 종이 하나(ReportPanel)를 작업 관리 mock 의 보고서·서명 응답에 붙여 본다.

const server = installReportServer();
const PAPER_TITLE = 'TBM(작업 전 안전대화) 보고서';
const EDIT = { name: 'TBM 보고서 편집' };

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/** 머리 칸(th) 바로 옆 값 칸. */
const valueOf = (label: string): HTMLElement => {
  const cell = screen.getByText(label, { selector: 'th' }).nextElementSibling;
  if (!(cell instanceof HTMLElement)) throw new Error(`${label} 옆 칸이 없다`);
  return cell;
};
const isStriped = (cell: Element) => cell.className.includes('repeating-linear-gradient');

describe('보고서 읽기', () => {
  it('받는 중에는 줄무늬 빈 종이를 보이고, 받으면 작업의 보고서를 그린다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);

    // 받는 중: 제목은 있고 아직 누를 수 없다.
    expect(screen.getByText(PAPER_TITLE)).toBeTruthy();
    expect(screen.queryByRole('button', EDIT)).toBeNull();
    expect(isStriped(valueOf('작업명'))).toBe(true);

    await screen.findByRole('button', EDIT);
    expect(screen.getByText('+ 작업내용 선택')).toBeTruthy();
    // 아직 쓰지 않은 TBM 의 일시는 서버가 넣은 작업 생성 시각이라 보이지 않는다(-734)
    expect(valueOf('일시').textContent).toBe('');
  });

  it('초안 전(PENDING)에는 시스템이 채울 칸이 줄무늬이고 리더가 안 보인다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    for (const label of ['작업명', '장소', '위험성평가 여부', '중점위험', '리더 소속', '성명']) {
      expect(isStriped(valueOf(label)), label).toBe(true);
    }
    expect(screen.queryByText('김안전')).toBeNull();
  });

  it('초안을 만드는 동안(GENERATING)은 줄무늬가 이어지고 끝나면(SUCCEEDED) 값과 리더가 나타난다', async () => {
    const day = await openDay();
    server.mock.markSetupDone(day.work_id);
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    expect(isStriped(valueOf('작업명'))).toBe(true);
    expect(screen.queryByText('김안전')).toBeNull();

    // 2초마다 다시 받다가 초안이 끝나면 줄무늬가 걷힌다.
    server.clock += DRAFT_DELAY_MS;
    await waitFor(() => expect(valueOf('성명').textContent).toBe('김안전'), { timeout: 6_000 });
    expect(valueOf('리더 소속').textContent).toBe('(주)안전건설');
    expect(valueOf('직책').textContent).toBe('안전관리자');
    expect(valueOf('장소').textContent).not.toBe('');
    expect(isStriped(valueOf('장소'))).toBe(false);
    expect(isStriped(valueOf('중점위험'))).toBe(false);
  });

  it('초안이 실패(FAILED)해도 줄무늬를 걷고 사람이 채울 수 있게 한다', async () => {
    const day = await openDay();
    server.mock.failDraft(day.work_id);
    server.mock.markSetupDone(day.work_id);
    server.clock += DRAFT_DELAY_MS;
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    expect(isStriped(valueOf('작업명'))).toBe(false);
  });

  it('서명 목록의 이름과 이미지가 참석자 줄에 들어간다', async () => {
    const day = await openDay();
    await signAs(day.work_id, '박반장');
    await signAs(day.work_id, '김안전');
    renderWithClient(<ReportPanel workId={day.work_id} editable={false} />);
    const image = await screen.findByAltText('박반장 서명');
    expect(image.getAttribute('src')).toMatch(/^http:\/\/api\.test\/mock-signature-image\//);
    expect(screen.getByAltText('김안전 서명')).toBeTruthy();
    expect(screen.getAllByText('박반장')).toHaveLength(1);
  });

  it('종료 직후 종료 미팅 칸은 비어 있다가 서버가 채우는 대로 바뀐다(같은 보고서)', async () => {
    const day = await openDay();
    await requestEnd(server, day.work_id);
    const { report_id: reportId } = await latestReport(day.work_id);
    renderWithClient(<ReportPanel workId={day.work_id} editable={false} />);
    await waitFor(() => expect(valueOf('일시').textContent).toBe('2026-11-11 09:00'));
    expect(valueOf('종료 미팅').textContent).toBe('');

    server.clock += DRAFT_DELAY_MS;
    await waitFor(
      () =>
        expect(valueOf('종료 미팅').textContent).toBe(
          '작업 종료 · 총 작업 시간 00:01:00, 사건 0건',
        ),
      { timeout: 5_000 },
    );
    expect((await latestReport(day.work_id)).report_id).toBe(reportId);
  });

  it('보고서를 못 받으면 알리고 다시 불러올 수 있다', async () => {
    const day = await openDay();
    let fail = true;
    server.server.use(
      http.get('*/api/reports/tbm', () =>
        fail ? HttpResponse.json({ code: 'BOOM' }, { status: 500 }) : undefined,
      ),
    );
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    // retry 를 끈 QueryClient 라 바로 실패로 온다.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('보고서를 불러오지 못했습니다');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    await screen.findByRole('button', EDIT);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('편집', () => {
  it('종이를 누르면 편집 창이 열리고 저장하면 종이에 반영되며 저장했습니다 가 보인다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    fireEvent.click(await screen.findByRole('button', EDIT));
    expect(await screen.findByRole('dialog', EDIT)).toBeTruthy();
    fireEvent.click(await screen.findByRole('checkbox', { name: '철근 배근' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('저장했습니다')).toBeTruthy();
    expect(screen.queryByRole('dialog', EDIT)).toBeNull();
    expect(await screen.findByText('• 철근 배근')).toBeTruthy();
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
    expect((await latestReport(day.work_id)).form?.info.tasks).toEqual([{ code: 'REBAR' }]);
    // 잠시 뒤 알림은 사라진다.
    await waitFor(() => expect(screen.queryByText('저장했습니다')).toBeNull(), { timeout: 4_000 });
  });

  it('Enter 로도 편집 창을 연다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    fireEvent.keyDown(await screen.findByRole('button', EDIT), { key: 'Enter' });
    expect(await screen.findByRole('dialog', EDIT)).toBeTruthy();
  });

  it('취소하면 창만 닫히고 저장하지 않는다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    fireEvent.click(await screen.findByRole('button', EDIT));
    fireEvent.click(await screen.findByRole('checkbox', { name: '철근 배근' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', EDIT)).toBeNull());
    expect(screen.queryByText('저장했습니다')).toBeNull();
    expect((await latestReport(day.work_id)).form?.info.tasks).toEqual([]);
  });

  it('고칠 수 없게 하면(editable=false) 종이는 단추가 아니고 + 작업내용 선택 도 없다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable={false} />);
    await waitFor(() => expect(valueOf('일시').textContent).toBe('2026-11-11 09:00'));
    expect(screen.queryByRole('button', EDIT)).toBeNull();
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
  });

  it('제출한 보고서는 보냄 칩이 보이고 고칠 수 없다', async () => {
    const day = await openDay();
    const submitted = await submitDay(server, day.work_id);
    expect(submitted.submitted_at).not.toBeNull();
    renderWithClient(<ReportPanel workId={day.work_id} editable withPrint />);
    expect(await screen.findByText('보냄 2026-11-11 09:01')).toBeTruthy();
    expect(screen.queryByRole('button', EDIT)).toBeNull();
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
    // 출력은 제출한 뒤에도 된다.
    expect(screen.getByRole('button', { name: '출력' })).toBeTruthy();
  });

  it('제출 전에는 보냄 칩이 없다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    expect(screen.queryByText(/^보냄 /)).toBeNull();
  });
});

describe('출력', () => {
  it('withPrint 가 아니면 출력 단추가 없다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    expect(screen.queryByRole('button', { name: '출력' })).toBeNull();
  });

  it('보고서를 받기 전에는 출력 단추가 꺼져 있다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable withPrint />);
    expect((screen.getByRole('button', { name: '출력' }) as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole('button', EDIT);
    expect((screen.getByRole('button', { name: '출력' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('출력하면 종이 사본을 body 에 두고 인쇄한 뒤 거둔다(다른 UI 는 인쇄에서 숨는다)', async () => {
    const day = await openDay();
    let papersWhilePrinting = 0;
    let printRootClass = '';
    let printRootIsBodyChild = false;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      papersWhilePrinting = screen.getAllByText(PAPER_TITLE).length;
      const root = document.body.lastElementChild;
      printRootClass = root?.className ?? '';
      printRootIsBodyChild = root?.parentElement === document.body && !!root?.querySelector('h3');
    });
    renderWithClient(<ReportPanel workId={day.work_id} editable withPrint />);
    await screen.findByRole('button', EDIT);
    expect(screen.getAllByText(PAPER_TITLE)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '출력' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(papersWhilePrinting).toBe(2);
    expect(printRootIsBodyChild).toBe(true);
    // 화면에서는 숨고(hidden) 인쇄할 때만 보이며(print:block), body 의 다른 자식은 인쇄에서 숨긴다.
    expect(printRootClass).toContain('hidden');
    expect(printRootClass).toContain('print:block');
    expect(printRootClass).toContain('hidden!');
    // 인쇄가 끝나면 사본을 거둔다.
    expect(screen.getAllByText(PAPER_TITLE)).toHaveLength(1);
    expect(document.body.querySelectorAll('style')).toHaveLength(0);
  });

  it('인쇄 사본에는 편집 안내(+ 작업내용 선택)가 찍히지 않는다', async () => {
    const day = await openDay();
    let printedPick = 0;
    vi.spyOn(window, 'print').mockImplementation(() => {
      printedPick = screen.getAllByText('+ 작업내용 선택').length;
    });
    renderWithClient(<ReportPanel workId={day.work_id} editable withPrint />);
    await screen.findByRole('button', EDIT);
    fireEvent.click(screen.getByRole('button', { name: '출력' }));
    // 화면 종이의 안내 하나뿐이고 사본에는 없다.
    expect(printedPick).toBe(1);
  });
});

describe('AI 초안 요청(S15P31A101-624)', () => {
  const DRAFT = { name: 'AI 초안 만들기' };

  /** 작업내용을 하나 골라 저장한다(초안은 작업내용이 있어야 만든다). */
  async function chooseTask(workId: string) {
    const report = await latestReport(workId);
    await saveReportForm(api, report.report_id, {
      form: {
        ...blankReportForm(T0),
        info: { ...blankReportForm(T0).info, tasks: [{ code: 'REBAR' }] },
      },
      form_revision: report.form_revision,
    });
  }

  it('서버가 초안을 시작하지 않았으면 단추로 요청하고, 만드는 동안 줄무늬였다가 끝나면 값이 채워진다', async () => {
    const day = await openDay();
    await chooseTask(day.work_id);
    renderWithClient(<ReportPanel workId={day.work_id} editable draftable />);
    const button = await screen.findByRole('button', DRAFT);
    expect(isStriped(valueOf('장소'))).toBe(true);

    fireEvent.click(button);
    // 요청하면 GENERATING 이라 단추가 사라지고, 2초마다 다시 받다가 끝나면 줄무늬가 걷힌다
    await waitFor(() => expect(screen.queryByRole('button', DRAFT)).toBeNull());
    expect((await latestReport(day.work_id)).draft_status).toBe('GENERATING');
    server.clock += DRAFT_DELAY_MS;
    await waitFor(() => expect(valueOf('성명').textContent).toBe('김안전'), { timeout: 6_000 });
    expect(isStriped(valueOf('장소'))).toBe(false);
  });

  it('작업내용이 없으면 단추를 끄고, 세팅 전 화면(draftable 아님)·읽기 전용에는 단추가 없다', async () => {
    const day = await openDay();
    renderWithClient(<ReportPanel workId={day.work_id} editable draftable />);
    const button = await screen.findByRole('button', DRAFT);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    renderWithClient(<ReportPanel workId={day.work_id} editable />);
    await screen.findByRole('button', EDIT);
    expect(screen.queryByRole('button', DRAFT)).toBeNull();
    cleanup();

    renderWithClient(<ReportPanel workId={day.work_id} editable={false} draftable />);
    await waitFor(() => expect(valueOf('일시').textContent).toBe('2026-11-11 09:00'));
    expect(screen.queryByRole('button', DRAFT)).toBeNull();
  });

  it('초안이 실패하면 다시 만들기 단추로 다시 요청한다', async () => {
    const day = await openDay();
    await chooseTask(day.work_id);
    server.mock.failDraft(day.work_id);
    server.mock.markSetupDone(day.work_id);
    server.clock += DRAFT_DELAY_MS;
    expect((await latestReport(day.work_id)).draft_status).toBe('FAILED');
    renderWithClient(<ReportPanel workId={day.work_id} editable draftable />);
    fireEvent.click(await screen.findByRole('button', { name: 'AI 초안 다시 만들기' }));
    await waitFor(async () =>
      expect((await latestReport(day.work_id)).draft_status).toBe('GENERATING'),
    );
  });

  it('이미 만드는 중(409 REPORT_IN_PROGRESS)이면 알리고 보고서를 다시 받는다', async () => {
    const day = await openDay();
    await chooseTask(day.work_id);
    server.server.use(
      http.post('*/api/reports/tbm/:reportId/form-draft', () =>
        HttpResponse.json(
          { status: 409, code: 'REPORT_IN_PROGRESS', detail: '생성 중' },
          { status: 409 },
        ),
      ),
    );
    renderWithClient(<ReportPanel workId={day.work_id} editable draftable />);
    fireEvent.click(await screen.findByRole('button', DRAFT));
    expect((await screen.findByRole('alert')).textContent).toBe('초안을 이미 만들고 있어요');
  });
});

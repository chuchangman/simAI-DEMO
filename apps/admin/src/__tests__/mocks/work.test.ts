// @vitest-environment node
import { hasMonitorableWork, todayWorks } from '@/features/monitor/todayWorks';
import { requestTbmWorks } from '@/features/tbm/api';
import {
  deleteSignature,
  endWork,
  fetchReportsByWork,
  fetchSignatures,
  fetchWorkTasks,
  fetchWorkUnit,
  fetchWorkUnits,
  postSignature,
  putDailyWorkUnit,
  saveReportForm,
  signReport,
  startReportDraft,
  startWork,
  submitReport,
  uploadSignatureImage,
  WORK_ERROR,
  workErrorOf,
  type WorkErrorCode,
} from '@/features/work/api';
import { blankReportForm } from '@/features/work/reportForm';
import {
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_COUNT,
  signatureResultSchema,
  workReportSchema,
  workSignaturesResponseSchema,
  type ReportForm,
  type SignatureRequestBody,
  type WorkReport,
} from '@/features/work/types';
import { ApiError, createHttp } from '@/lib/http';
import { createHistoryMock } from '@/mocks/history';
import { createTbmMock } from '@/mocks/tbm';
import {
  createWorkMock,
  draftReportForm,
  endingMeetingText,
  normalizeReportForm,
  type MockSetupSession,
  type WorkMock,
} from '@/mocks/work';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// 작업 관리 새 흐름 mock(src/mocks/work.ts)을 실제 요청 함수(features/work/api)로 한 바퀴 돈다.

const BASE = 'http://api.test';
const TODAY = '2026-11-11';
const TOMORROW = '2026-11-12';
const T0 = new Date(2026, 10, 11, 9, 0).getTime();
const DRAFT_DELAY_MS = 2_500;

let clock = T0;
const now = () => clock;
const sessions: MockSetupSession[] = [];
let mock: WorkMock;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  clock = T0;
  sessions.length = 0;
  mock = createWorkMock({ now, setupSessions: () => sessions, draftDelayMs: DRAFT_DELAY_MS });
  // 실제 handlers.ts 와 같은 순서: 새 mock 이 먼저 답하고 모르는 요청은 옛 TBM·히스토리 mock 으로 넘어간다.
  server.resetHandlers(
    ...mock.handlers,
    ...createTbmMock({ deferDaysToHistory: true }).handlers,
    ...createHistoryMock({ now }).handlers,
  );
});

const asAdmin = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.admin' });
const asViewer = createHttp({ baseUrl: BASE, getToken: () => 'mock-token.viewer' });
const anonymous = createHttp({ baseUrl: BASE });

/** 서명 PNG 흉내(내용은 mock 이 보지 않는다). */
const png = () =>
  new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

/** 실패한 요청의 상태·우리가 아는 오류 코드. 성공했으면 null. */
async function failure(
  promise: Promise<unknown>,
): Promise<{ status: number; code: WorkErrorCode | null } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { status: error.status, code: workErrorOf(error) };
  }
}

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('값이 없다');
  return value;
};

const openToday = () => putDailyWorkUnit(asAdmin, TODAY);
/** 보고서 한 판(GET /api/reports/tbm/{id}). 앱은 판 id 로 직접 읽지 않아 요청 함수 없이 mock 만 확인한다. */
const fetchReport = (reportId: number): Promise<WorkReport> =>
  asAdmin(`/api/reports/tbm/${reportId}`, { schema: workReportSchema });
const latestOf = async (workId: string): Promise<WorkReport> =>
  must((await fetchReportsByWork(asAdmin, workId)).latest);
const formOf = (report: WorkReport): ReportForm => must(report.form);

/** 서명 추가 요청 본문 샘플(올린 이미지를 mock 이 보지 않아 키·해시는 아무 값이다). */
const signatureBody = (overrides: Partial<SignatureRequestBody> = {}): SignatureRequestBody => ({
  report_version: 1,
  signer_name: '김일',
  image_key: 'signatures/a.png',
  image_sha256: 'a'.repeat(64),
  ...overrides,
});
/** 결재자 서명(화면은 보내지 않아 요청 함수의 본문 타입에는 없다). */
const postApprover = (reportId: number) =>
  asAdmin(`/api/reports/tbm/${reportId}/signatures`, {
    method: 'POST',
    body: { ...signatureBody({ signer_name: '결재자' }), signer_role: 'APPROVER' },
    schema: signatureResultSchema,
  });

/** 세팅 세션이 시작됐다가 끝나고 구역이 한 번 저장됐다. */
function startSession(workId: string) {
  const session: MockSetupSession = {
    setup_session_id: `session-${workId}`,
    work_unit_id: Number(workId),
    status: 'COLLECTING_BACKGROUND',
    zones_committed_at: null,
    started_at_ms: clock,
  };
  sessions.push(session);
  return session;
}
function finishSession(session: MockSetupSession) {
  session.status = 'COMPLETED';
  session.zones_committed_at = clock;
  // 작업 관리의 '세팅 끝'은 세팅 완료(-615)가 정한다
  session.setup_completed_at_ms = clock;
}

/** 작업 전 확인까지 와서 서명 한 명이 있다. */
async function readyToStart() {
  const work = await openToday();
  mock.markSetupDone(work.work_id);
  const report = await latestOf(work.work_id);
  await signReport(asAdmin, report.report_id, {
    image: png(),
    signerName: '박반장',
    reportVersion: report.report_version,
  });
  return { work, report };
}

describe('작업 관리 mock: 날짜 열기', () => {
  it('오늘 이전 날짜는 거절하고 오늘은 멱등으로 만든다', async () => {
    expect(await failure(putDailyWorkUnit(asAdmin, '2026-11-10'))).toEqual({
      status: 409,
      code: WORK_ERROR.DATE_PAST,
    });
    expect(await failure(putDailyWorkUnit(asAdmin, '2026-02-30'))).toEqual({
      status: 400,
      code: null,
    });

    const first = await openToday();
    expect(first).toMatchObject({
      date: TODAY,
      name: '',
      daily: true,
      progress: 'REPORT',
      status: 'PLANNED',
      active_setup_session_id: null,
    });
    expect(first.tbm_report).toEqual({
      report_id: expect.any(Number),
      draft_status: null,
      submitted_at: null,
    });

    const second = await openToday();
    expect(second.work_id).toBe(first.work_id);
    expect(second.tbm_report?.report_id).toBe(first.tbm_report?.report_id);
    const month = await fetchWorkUnits(asAdmin, { from: '2026-11-01', to: '2026-11-30' });
    expect(month.filter((w) => w.daily)).toHaveLength(1);
  });

  it('이미 열어 둔 날은 지난 뒤에도 그대로 돌려주고, 없는 지난 날짜만 거절한다(WORK_DATE_PAST)', async () => {
    const opened = await openToday();
    clock += 24 * 60 * 60 * 1000; // 하루가 지나 그 날이 지난 날짜가 됐다.

    const again = await putDailyWorkUnit(asAdmin, TODAY);
    expect(again.work_id).toBe(opened.work_id);
    expect(await failure(putDailyWorkUnit(asAdmin, '2026-11-09'))).toEqual({
      status: 409,
      code: WORK_ERROR.DATE_PAST,
    });
  });

  it('빈 보고서: PENDING·초안 없음·빈 양식·리더 계정, 일시는 오늘이면 지금', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    expect(report).toMatchObject({
      work_id: work.work_id,
      report_version: 1,
      status: 'PENDING',
      draft_status: null,
      form_revision: 0,
      locked_at: null,
      submitted_at: null,
      signature_count: 0,
      leader: { name: '김안전', org: '(주)안전건설', title: '안전관리자' },
      header: { date: TODAY, name: '' },
    });
    expect(report.form).toEqual(blankReportForm(T0));
    expect((await fetchReport(report.report_id)).report_id).toBe(report.report_id);
    expect((await fetchReportsByWork(asAdmin, work.work_id)).versions).toHaveLength(1);
  });

  it('예정인 날은 그날 07:30 으로 만들고 시작은 못 한다(WORK_NOT_TODAY)', async () => {
    const future = await putDailyWorkUnit(asAdmin, TOMORROW);
    expect(future.progress).toBe('REPORT');
    const report = await latestOf(future.work_id);
    expect(formOf(report).info.date_time_ms).toBe(new Date(2026, 10, 12, 7, 30).getTime());
    // 서명이 없어도 날짜 검사가 먼저다.
    expect(await failure(startWork(asAdmin, future.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.NOT_TODAY,
    });
  });

  it('작업내용 항목은 서버와 같은 7개다', async () => {
    const tasks = await fetchWorkTasks(asAdmin);
    expect(tasks.map((t) => t.code)).toEqual([
      'SLAB_OPENING_COVER',
      'WORK_PLATFORM',
      'FORMWORK',
      'REBAR',
      'MATERIAL_HANDLING',
      'EXTERIOR_SCAFFOLD_CHECK',
      'FLOOR_FINISHING',
    ]);
    expect(tasks[0]).toEqual({
      code: 'SLAB_OPENING_COVER',
      label: '슬래브 개구부 덮개 설치',
      rule_tags: ['R1', 'R2', 'R5'],
    });
  });
});

describe('작업 관리 mock: 종료 문장', () => {
  it('종료 문장은 총 작업 시간(HH:MM:SS)과 사건 수다', () => {
    expect(endingMeetingText(5_405_000, 3)).toBe('작업 종료 · 총 작업 시간 01:30:05, 사건 3건');
  });
});

describe('작업 관리 mock: 양식 저장', () => {
  it('작업내용을 바꾸면 작업명을 채우고 revision 을 올린다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const form = formOf(report);
    const saved = await saveReportForm(asAdmin, report.report_id, {
      form: {
        ...form,
        info: { ...form.info, tasks: [{ code: 'REBAR' }, { text: ' 직접 쓴 작업 ' }] },
      },
      form_revision: report.form_revision,
    });
    expect(saved.form_revision).toBe(1);
    expect(saved.report_version).toBe(1);
    expect(formOf(saved).info.task_name).toBe('철근 배근 외 1건');
    expect(formOf(saved).info.tasks).toEqual([{ code: 'REBAR' }, { text: '직접 쓴 작업' }]);
    expect(saved.header?.name).toBe('철근 배근 외 1건');
    expect((await fetchWorkUnit(asAdmin, work.work_id)).name).toBe('철근 배근 외 1건');

    // 작업내용을 모두 지우면 작업명도 빈다.
    const cleared = await saveReportForm(asAdmin, report.report_id, {
      form: { ...formOf(saved), info: { ...formOf(saved).info, tasks: [] } },
      form_revision: saved.form_revision,
    });
    expect(formOf(cleared).info.task_name).toBe('');
    expect((await fetchWorkUnit(asAdmin, work.work_id)).name).toBe('');
  });

  it('작업내용이 그대로면 사람이 고친 작업명을 지키고 점검 문구는 서버 값으로 덮는다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const form = formOf(report);
    const saved = await saveReportForm(asAdmin, report.report_id, {
      form: {
        ...form,
        info: { ...form.info, task_name: '내가 쓴 작업명' },
        checks: form.checks.map((c, i) => (i === 0 ? { ...c, label: '바꾼 문구', yes: true } : c)),
      },
      form_revision: 0,
    });
    expect(formOf(saved).info.task_name).toBe('내가 쓴 작업명');
    expect(formOf(saved).checks[0]).toMatchObject({
      label: '안전모 등 보호구 착용 상태 확인',
      yes: true,
    });
    expect((await fetchWorkUnit(asAdmin, work.work_id)).name).toBe('');
  });

  it('revision 이 다르면 REPORT_FORM_CONFLICT, 모양이 틀리면 400', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const form = formOf(report);
    await saveReportForm(asAdmin, report.report_id, { form, form_revision: 0 });
    expect(
      await failure(saveReportForm(asAdmin, report.report_id, { form, form_revision: 0 })),
    ).toEqual({
      status: 409,
      code: WORK_ERROR.REPORT_FORM_CONFLICT,
    });
    const badRows = { ...form, risks: form.risks.slice(0, 2) };
    expect(
      await failure(saveReportForm(asAdmin, report.report_id, { form: badRows, form_revision: 1 })),
    ).toEqual({
      status: 400,
      code: null,
    });
    const unknownTask = { ...form, info: { ...form.info, tasks: [{ code: 'NOPE' }] } };
    expect(
      await failure(
        saveReportForm(asAdmin, report.report_id, { form: unknownTask, form_revision: 1 }),
      ),
    ).toEqual({
      status: 400,
      code: null,
    });
  });

  it('normalizeReportForm 은 서버 TbmForm 처럼 검사한다', () => {
    const blank = blankReportForm(1);
    expect(normalizeReportForm(blank)).toEqual(blank);
    expect(normalizeReportForm({ ...blank, checks: [...blank.checks].reverse() })).toBeNull();
    expect(
      normalizeReportForm({
        ...blank,
        info: { ...blank.info, tasks: [{ code: 'REBAR' }, { code: 'REBAR' }] },
      }),
    ).toBeNull();
    expect(
      normalizeReportForm({ ...blank, info: { ...blank.info, tasks: [{ text: '  ' }] } }),
    ).toBeNull();
    expect(
      normalizeReportForm({ ...blank, info: { ...blank.info, place: 'x'.repeat(201) } }),
    ).toBeNull();
    expect(
      normalizeReportForm({ ...blank, review: { daily: 'x'.repeat(2001), ending: '' } }),
    ).toBeNull();
    const many = Array.from({ length: 21 }, (_, i) => ({ text: `작업 ${i}` }));
    expect(normalizeReportForm({ ...blank, info: { ...blank.info, tasks: many } })).toBeNull();
  });
});

describe('작업 관리 mock: 세팅과 초안', () => {
  it('세션이 있으면 SETUP, 끝나면 SETUP_DONE 이고 초안이 GENERATING → SUCCEEDED 로 빈 칸을 채운다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const form = formOf(report);
    // 사람이 쓴 칸(작업내용·장소)은 초안이 지킨다.
    await saveReportForm(asAdmin, report.report_id, {
      form: {
        ...form,
        info: {
          ...form.info,
          tasks: [{ code: 'REBAR' }, { text: '직접 쓴 작업' }],
          place: '3층 슬래브',
        },
      },
      form_revision: 0,
    });

    const session = startSession(work.work_id);
    const setup = await fetchWorkUnit(asAdmin, work.work_id);
    expect(setup.progress).toBe('SETUP');
    expect(setup.active_setup_session_id).toBe(session.setup_session_id);
    expect((await latestOf(work.work_id)).draft_status).toBeNull();

    // COMPLETED 만으로는 세팅이 끝난 게 아니다(구역을 한 번 저장해야 한다).
    session.status = 'COMPLETED';
    expect((await fetchWorkUnit(asAdmin, work.work_id)).progress).toBe('SETUP');
    finishSession(session);

    const done = await fetchWorkUnit(asAdmin, work.work_id);
    expect(done.progress).toBe('SETUP_DONE');
    expect(done.active_setup_session_id).toBeNull();
    expect(done.tbm_report?.draft_status).toBe('GENERATING');
    const generating = await latestOf(work.work_id);
    expect(generating).toMatchObject({ status: 'GENERATING', draft_status: 'GENERATING' });
    expect(formOf(generating).info.risk_assessed).toBeNull();

    clock += DRAFT_DELAY_MS - 1;
    expect((await latestOf(work.work_id)).draft_status).toBe('GENERATING');
    clock += 1;
    const drafted = await latestOf(work.work_id);
    expect(drafted).toMatchObject({ status: 'SUCCEEDED', draft_status: 'SUCCEEDED' });
    const filled = formOf(drafted);
    expect(filled.info).toMatchObject({
      task_name: '철근 배근 외 1건',
      place: '3층 슬래브',
      risk_assessed: true,
    });
    expect(filled.risks[0]).toEqual({ risk: '개구부 추락', measure: '덮개·난간 설치, 접근 통제' });
    expect(filled.risks.map((r) => r.risk)).toEqual([
      '개구부 추락',
      '작업 발판 위 추락·전도',
      '바닥 가장자리 추락',
    ]);
    expect(filled.focus).toEqual({ risk: '개구부 추락', measure: '덮개·난간 설치, 접근 통제' });
    expect(filled.checks.map((c) => c.yes)).toEqual([true, true, false, true, true]);
    expect(filled.checks[2]?.action).toBe('덮개 설치 전까지 접근 통제');
    expect(filled.review.daily).toBe('작업 전 위험구역 3곳 확인, 접근 통제 실시');
    // 초안이 양식을 바꿨으니 revision 이 올라, 예전 revision 으로 저장하면 충돌한다.
    expect(drafted.form_revision).toBe(2);
    expect(
      await failure(saveReportForm(asAdmin, drafted.report_id, { form: filled, form_revision: 1 })),
    ).toEqual({ status: 409, code: WORK_ERROR.REPORT_FORM_CONFLICT });
  });

  it('markSetupDone 도우미: 구역 이름이 장소가 되고 위험 구역이 없으면 현장 전체', async () => {
    const withZones = await openToday();
    expect(mock.markSetupDone()).toBe(withZones.work_id);
    clock += DRAFT_DELAY_MS;
    expect(formOf(await latestOf(withZones.work_id)).info.place).toBe(
      '개구부 위험 구역, 고소 작업면 둘레, 바닥 가장자리',
    );

    expect(draftReportForm(blankReportForm(1), []).info.place).toBe('현장 전체');
    expect(draftReportForm(blankReportForm(1), []).checks.every((c) => c.yes === true)).toBe(true);
  });

  it('초안이 실패하면 FAILED 로 끝나고 빈 칸은 그대로다', async () => {
    const work = await openToday();
    mock.failDraft(work.work_id);
    mock.markSetupDone(work.work_id);
    clock += DRAFT_DELAY_MS;
    const report = await latestOf(work.work_id);
    expect(report).toMatchObject({
      status: 'FAILED',
      draft_status: 'FAILED',
      failure_reason: 'LLM_UNAVAILABLE',
    });
    expect(formOf(report).info.place).toBe('');
    expect((await fetchWorkUnit(asAdmin, work.work_id)).progress).toBe('SETUP_DONE');
  });
});

describe('작업 관리 mock: 서명', () => {
  it('보고서가 PENDING 이어도 서명할 수 있고 첫 서명이 잠그지 않는다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    expect(report.status).toBe('PENDING');
    const result = await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '  박반장 ',
      reportVersion: report.report_version,
    });
    expect(result).toMatchObject({
      report_id: report.report_id,
      report_version: 1,
      signer_name: '박반장',
      locked_at: null,
    });
    expect((await latestOf(work.work_id)).locked_at).toBeNull();
    expect((await latestOf(work.work_id)).signature_count).toBe(1);

    const [item] = await fetchSignatures(asAdmin, report.report_id);
    expect(item).toMatchObject({
      signature_id: result.signature_id,
      signer_name: '박반장',
      signer_role: 'PARTICIPANT',
      report_version: 1,
    });
    // 올린 서명 이미지를 서명 이미지 주소로 다시 받을 수 있다(tbm mock 의 저장소).
    expect((await fetch(must(item).image_url)).status).toBe(200);
  });

  it('여러 명이 서명하고 작업 시작 전에는 지울 수 있다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const sign = (name: string) =>
      signReport(asAdmin, report.report_id, { image: png(), signerName: name, reportVersion: 1 });
    const first = await sign('김일');
    await sign('이이');
    await sign('박삼');
    expect((await fetchSignatures(asAdmin, report.report_id)).map((s) => s.signer_name)).toEqual([
      '김일',
      '이이',
      '박삼',
    ]);

    await deleteSignature(asAdmin, report.report_id, first.signature_id);
    expect((await fetchSignatures(asAdmin, report.report_id)).map((s) => s.signer_name)).toEqual([
      '이이',
      '박삼',
    ]);
    expect((await latestOf(work.work_id)).signature_count).toBe(2);
    expect(await failure(deleteSignature(asAdmin, report.report_id, first.signature_id))).toEqual({
      status: 404,
      code: WORK_ERROR.SIGNATURE_NOT_FOUND,
    });
  });

  it('256KiB 를 넘는 서명 이미지는 요청 없이 거절하고 저장소가 거절하면 업로드 실패다', async () => {
    const big = new Blob([new Uint8Array(SIGNATURE_MAX_BYTES + 1)], { type: 'image/png' });
    await expect(uploadSignatureImage(asAdmin, big)).rejects.toMatchObject({ reason: 'TOO_LARGE' });
    server.use(
      http.put('*/mock-signature-upload/:key', () => new HttpResponse(null, { status: 500 })),
    );
    await expect(uploadSignatureImage(asAdmin, png())).rejects.toMatchObject({
      reason: 'UPLOAD_FAILED',
    });
  });

  it('요청 값·판·인원을 검사한다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    const body = signatureBody();
    const invalid = { status: 400, code: WORK_ERROR.INVALID_SIGNATURE };
    expect(
      await failure(postSignature(asAdmin, report.report_id, { ...body, signer_name: ' ' })),
    ).toEqual(invalid);
    expect(
      await failure(
        postSignature(asAdmin, report.report_id, { ...body, signer_name: '가'.repeat(41) }),
      ),
    ).toEqual(invalid);
    expect(
      await failure(postSignature(asAdmin, report.report_id, { ...body, image_sha256: 'zz' })),
    ).toEqual(invalid);
    expect(
      await failure(
        asAdmin(`/api/reports/tbm/${report.report_id}/signatures`, {
          method: 'POST',
          body: { ...body, signer_role: 'WITNESS' },
          schema: signatureResultSchema,
        }),
      ),
    ).toEqual(invalid);
    expect(
      await failure(postSignature(asAdmin, report.report_id, { ...body, report_version: 2 })),
    ).toEqual({
      status: 409,
      code: WORK_ERROR.REPORT_VERSION_STALE,
    });
    for (let i = 0; i < 50; i += 1) {
      await postSignature(asAdmin, report.report_id, { ...body, signer_name: `참석자${i}` });
    }
    expect(await failure(postSignature(asAdmin, report.report_id, body))).toEqual({
      status: 409,
      code: WORK_ERROR.SIGNATURE_LIMIT_REACHED,
    });
  });

  it('서명 응답은 서버처럼 역할과 내용 해시(문자열)를 담고, 요청 본문에는 notice_acknowledged 를 싣지 않는다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    let sent: unknown = null;
    server.use(
      http.post('*/api/reports/tbm/:id/signatures', async ({ request }) => {
        sent = await request.clone().json();
      }),
    );
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '박반장',
      reportVersion: 1,
    });
    expect(sent).toEqual({
      report_version: 1,
      signer_name: '박반장',
      signer_role: 'PARTICIPANT',
      image_key: expect.any(String),
      image_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const response = await fetch(`${BASE}/api/reports/tbm/${report.report_id}/signatures`, {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-token.admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(signatureBody()),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      report_id: report.report_id,
      signer_role: 'PARTICIPANT',
      locked_at: null,
      content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('결재자(APPROVER) 서명도 받지만 시작·인원 상한·삭제는 참석자 서명만 본다', async () => {
    const work = await openToday();
    mock.markSetupDone(work.work_id);
    const report = await latestOf(work.work_id);
    const approver = await postApprover(report.report_id);
    expect(approver.signer_name).toBe('결재자');
    expect((await fetchSignatures(asAdmin, report.report_id)).map((s) => s.signer_role)).toEqual([
      'APPROVER',
    ]);
    expect((await latestOf(work.work_id)).signature_count).toBe(1);
    expect(await failure(startWork(asAdmin, work.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.NO_SIGNATURE,
    });
    expect(
      await failure(deleteSignature(asAdmin, report.report_id, approver.signature_id)),
    ).toEqual({ status: 404, code: WORK_ERROR.SIGNATURE_NOT_FOUND });

    for (let i = 0; i < SIGNATURE_MAX_COUNT; i += 1) {
      await postSignature(asAdmin, report.report_id, signatureBody({ signer_name: `참석자${i}` }));
    }
    expect(await failure(postSignature(asAdmin, report.report_id, signatureBody()))).toEqual({
      status: 409,
      code: WORK_ERROR.SIGNATURE_LIMIT_REACHED,
    });
    await postApprover(report.report_id);
    await startWork(asAdmin, work.work_id);
  });

  it('서명은 보고서(report_id)에 모이고 종료해도 같은 보고서라 그대로 남는다(version 을 주면 그 판의 서명이다)', async () => {
    const { work, report } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 60_000;
    expect((await endWork(asAdmin, work.work_id)).wrap_up.report_id).toBe(report.report_id);
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '종료 뒤',
      reportVersion: report.report_version,
    });

    const names = async (reportId: number) =>
      (await fetchSignatures(asAdmin, reportId)).map((s) => s.signer_name);
    expect(await names(report.report_id)).toEqual(['박반장', '종료 뒤']);
    expect((await latestOf(work.work_id)).signature_count).toBe(2);

    const namesOfVersion = async (reportId: number, version: number) =>
      (
        await asAdmin(`/api/reports/tbm/${reportId}/signatures?version=${version}`, {
          schema: workSignaturesResponseSchema,
        })
      ).items.map((s) => s.signer_name);
    expect(await namesOfVersion(report.report_id, 1)).toEqual(['박반장', '종료 뒤']);
    expect(await namesOfVersion(report.report_id, 2)).toEqual([]);
  });
});

describe('작업 관리 mock: 시작·종료·제출', () => {
  it('서명이 없으면 시작할 수 없고(WORK_NO_SIGNATURE) 서명 뒤에는 시작한다', async () => {
    const work = await openToday();
    mock.markSetupDone(work.work_id);
    expect(await failure(startWork(asAdmin, work.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.NO_SIGNATURE,
    });

    const report = await latestOf(work.work_id);
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '박반장',
      reportVersion: 1,
    });
    clock += 60_000;
    const started = await startWork(asAdmin, work.work_id);
    expect(started).toMatchObject({
      progress: 'IN_PROGRESS',
      status: 'IN_PROGRESS',
      actual_started_at: clock,
      actual_ended_at: null,
    });
    expect(await failure(startWork(asAdmin, work.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });
  });

  it('이 작업의 세팅을 완료하지 않으면 시작할 수 없다(WORK_SETUP_NOT_COMPLETED, 미리보기 맵만으로는 아니다)', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '박반장',
      reportVersion: 1,
    });
    const blocked = { status: 409, code: WORK_ERROR.SETUP_NOT_COMPLETED };
    expect(await failure(startWork(asAdmin, work.work_id))).toEqual(blocked);

    const session = startSession(work.work_id);
    for (const status of ['COLLECTING_BACKGROUND', 'READY_FOR_ZONES', 'BAKING_TEXTURE'] as const) {
      session.status = status;
      expect(await failure(startWork(asAdmin, work.work_id))).toEqual(blocked);
    }

    finishSession(session); // 세팅 완료(-615): setup_completed_at_ms
    expect((await startWork(asAdmin, work.work_id)).status).toBe('IN_PROGRESS');
  });

  it('시작 검사 순서: 예정 상태 → 오늘 날짜 → 세팅 완료 → 서명 → 진행 중인 다른 작업', async () => {
    const first = await openToday();
    const report = await latestOf(first.work_id);
    // 세팅을 완료하지 않았으면 서명이 없어도 세팅 오류가 먼저다(세팅 → 작업 전 확인 → 시작).
    expect(await failure(startWork(asAdmin, first.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.SETUP_NOT_COMPLETED,
    });
    mock.markSetupDone(first.work_id);
    expect(await failure(startWork(asAdmin, first.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.NO_SIGNATURE,
    });
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '박반장',
      reportVersion: 1,
    });
    await startWork(asAdmin, first.work_id);

    clock += 24 * 3_600_000;
    // 시작한 작업은 날짜가 지난 뒤에도 날짜(NOT_TODAY)가 아니라 상태(INVALID_STATE) 오류다.
    expect(await failure(startWork(asAdmin, first.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });

    const next = await putDailyWorkUnit(asAdmin, TOMORROW);
    await signReport(asAdmin, (await latestOf(next.work_id)).report_id, {
      image: png(),
      signerName: '김일',
      reportVersion: 1,
    });
    // 세팅을 완료하지 않았으면 진행 중인 다른 작업이 있어도 세팅 오류가 먼저다.
    expect(await failure(startWork(asAdmin, next.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.SETUP_NOT_COMPLETED,
    });
    mock.markSetupDone(next.work_id);
    expect(await failure(startWork(asAdmin, next.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.ALREADY_IN_PROGRESS,
    });
  });

  it('시작한 뒤에는 서명을 더할 수 있지만 지울 수는 없고 제출도 못 한다', async () => {
    const { work, report } = await readyToStart();
    const [signature] = await fetchSignatures(asAdmin, report.report_id);
    await startWork(asAdmin, work.work_id);
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '늦은참석',
      reportVersion: 1,
    });
    expect(await fetchSignatures(asAdmin, report.report_id)).toHaveLength(2);
    expect(
      await failure(deleteSignature(asAdmin, report.report_id, must(signature).signature_id)),
    ).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });
    expect(await failure(submitReport(asAdmin, report.report_id))).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });
  });

  it('종료하면 새 판 없이 같은 보고서가 GENERATING 이 되고, 지연 뒤 종료 미팅이 채워진다(서명은 그대로)', async () => {
    const { work, report } = await readyToStart();
    expect(await failure(endWork(asAdmin, work.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });
    await startWork(asAdmin, work.work_id);
    mock.setEventCounts(work.work_id, { CRITICAL: 1, HIGH: 2 });
    clock += 90 * 60_000 + 5_000;
    const ended = await endWork(asAdmin, work.work_id);
    expect(ended.work_unit).toMatchObject({
      progress: 'ENDED',
      status: 'DONE',
      actual_ended_at: clock,
      tbm_report: { report_id: report.report_id },
    });
    expect(ended.wrap_up).toEqual({
      status: 'GENERATING',
      report_id: report.report_id,
      reason: null,
      mode: 'FORM_ENDING',
    });

    // 채우는 중: 같은 보고서(report_id·report_version 그대로)이고 종료 미팅은 비어 있다.
    const { latest, versions } = await fetchReportsByWork(asAdmin, work.work_id);
    const during = must(latest);
    expect(during).toMatchObject({
      report_id: report.report_id,
      report_version: 1,
      wrap_up_status: 'GENERATING',
      locked_at: null,
      submitted_at: null,
      signature_count: 1,
    });
    expect(formOf(during).review.ending).toBe('');
    expect(versions.map((v) => v.report_version)).toEqual([1]);

    clock += DRAFT_DELAY_MS - 1;
    expect((await latestOf(work.work_id)).wrap_up_status).toBe('GENERATING');
    clock += 1;
    const done = await latestOf(work.work_id);
    expect(done).toMatchObject({
      report_id: report.report_id,
      report_version: 1,
      wrap_up_status: 'SUCCEEDED',
      form_revision: during.form_revision + 1,
    });
    expect(formOf(done).review.ending).toBe('작업 종료 · 총 작업 시간 01:30:05, 사건 3건');
    expect(await fetchSignatures(asAdmin, report.report_id)).toHaveLength(1);
  });

  it('종료 미팅이 이미 적혀 있으면(사람이 먼저 씀) 덮어쓰지 않고 revision 도 올리지 않는다', async () => {
    const { work } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 60_000;
    await endWork(asAdmin, work.work_id);
    const during = await latestOf(work.work_id);
    const saved = await saveReportForm(asAdmin, during.report_id, {
      form: {
        ...formOf(during),
        review: { ...formOf(during).review, ending: '직접 적은 종료 미팅' },
      },
      form_revision: during.form_revision,
    });

    clock += DRAFT_DELAY_MS;
    const done = await latestOf(work.work_id);
    expect(done).toMatchObject({
      wrap_up_status: 'SUCCEEDED',
      form_revision: saved.form_revision,
    });
    expect(formOf(done).review.ending).toBe('직접 적은 종료 미팅');
  });

  it('종료 미팅을 채우는 동안 제출하면 409 REPORT_NOT_READY 이고 잠그지 않으며, 다 채우면 제출된다', async () => {
    const { work } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 60_000;
    await endWork(asAdmin, work.work_id);
    const { report_id: reportId } = await latestOf(work.work_id);

    const notReady = { status: 409, code: WORK_ERROR.REPORT_NOT_READY };
    expect(await failure(submitReport(asAdmin, reportId))).toEqual(notReady);
    clock += DRAFT_DELAY_MS - 1;
    expect(await failure(submitReport(asAdmin, reportId))).toEqual(notReady);
    expect(await latestOf(work.work_id)).toMatchObject({
      wrap_up_status: 'GENERATING',
      locked_at: null,
      submitted_at: null,
    });

    clock += 1;
    await submitReport(asAdmin, reportId);
    const submitted = await latestOf(work.work_id);
    expect(submitted.wrap_up_status).toBe('SUCCEEDED');
    expect(formOf(submitted).review.ending).not.toBe('');
    expect(submitted.locked_at).not.toBeNull();
  });

  it('AI 초안을 쓰는 중(status GENERATING)이어도 제출은 409 REPORT_NOT_READY 다', async () => {
    const { work } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 60_000;
    await endWork(asAdmin, work.work_id);
    clock += DRAFT_DELAY_MS;
    const filled = await latestOf(work.work_id);
    expect(filled).toMatchObject({ status: 'SUCCEEDED', wrap_up_status: 'SUCCEEDED' });
    const ended = await saveReportForm(asAdmin, filled.report_id, {
      form: { ...formOf(filled), info: { ...formOf(filled).info, tasks: [{ code: 'REBAR' }] } },
      form_revision: filled.form_revision,
    });

    await startReportDraft(asAdmin, ended.report_id);
    expect(await latestOf(work.work_id)).toMatchObject({
      status: 'GENERATING',
      wrap_up_status: 'SUCCEEDED',
    });
    expect(await failure(submitReport(asAdmin, ended.report_id))).toEqual({
      status: 409,
      code: WORK_ERROR.REPORT_NOT_READY,
    });

    clock += DRAFT_DELAY_MS;
    await submitReport(asAdmin, ended.report_id);
    expect((await latestOf(work.work_id)).locked_at).not.toBeNull();
  });

  it('제출 검사 순서: 이미 제출 → 작업이 안 끝남 → 쓰는 중', async () => {
    const { work, report } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    // 진행 중이고 초안도 쓰는 중이어도 작업이 안 끝났다는 오류가 먼저다.
    expect(await failure(submitReport(asAdmin, report.report_id))).toEqual({
      status: 409,
      code: WORK_ERROR.INVALID_STATE,
    });

    clock += 60_000;
    await endWork(asAdmin, work.work_id);
    clock += DRAFT_DELAY_MS;
    await submitReport(asAdmin, report.report_id);
    // 제출한 뒤에는 쓰는 중이 아니어도 이미 제출했다는 오류다.
    expect(await failure(submitReport(asAdmin, report.report_id))).toEqual({
      status: 409,
      code: WORK_ERROR.REPORT_LOCKED,
    });
  });

  it('제출하면 잠기고 이후 양식 수정·서명·삭제는 REPORT_LOCKED 다', async () => {
    const { work } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 60_000;
    await endWork(asAdmin, work.work_id);
    clock += DRAFT_DELAY_MS;
    const latest = await latestOf(work.work_id);
    expect(latest.locked_at).toBeNull();
    expect(latest.wrap_up_status).toBe('SUCCEEDED');

    await signReport(asAdmin, latest.report_id, {
      image: png(),
      signerName: '종료 뒤 서명',
      reportVersion: latest.report_version,
    });
    clock += 1_000;
    await submitReport(asAdmin, latest.report_id);
    const submitted = await latestOf(work.work_id);
    expect(submitted).toMatchObject({
      submitted_at: clock,
      locked_at: clock,
      submitted_by_name: 'admin',
    });
    expect(submitted.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await fetchWorkUnit(asAdmin, work.work_id)).toMatchObject({
      progress: 'SUBMITTED',
      tbm_report: { report_id: latest.report_id, submitted_at: clock },
    });

    const locked = { status: 409, code: WORK_ERROR.REPORT_LOCKED };
    expect(await failure(submitReport(asAdmin, latest.report_id))).toEqual(locked);
    expect(
      await failure(
        saveReportForm(asAdmin, latest.report_id, {
          form: formOf(latest),
          form_revision: latest.form_revision,
        }),
      ),
    ).toEqual(locked);
    expect(
      await failure(
        signReport(asAdmin, latest.report_id, {
          image: png(),
          signerName: '늦게',
          reportVersion: latest.report_version,
        }),
      ),
    ).toEqual(locked);
    const [first] = await fetchSignatures(asAdmin, latest.report_id);
    expect(
      await failure(deleteSignature(asAdmin, latest.report_id, must(first).signature_id)),
    ).toEqual(locked);
  });

  it('진행 중인 작업이 있으면 다른 작업을 시작할 수 없다(자정을 넘겨 끝내지 않은 작업)', async () => {
    const { work } = await readyToStart();
    await startWork(asAdmin, work.work_id);
    clock += 24 * 3_600_000;
    const next = await putDailyWorkUnit(asAdmin, TOMORROW);
    mock.markSetupDone(next.work_id);
    const report = await latestOf(next.work_id);
    await signReport(asAdmin, report.report_id, {
      image: png(),
      signerName: '박반장',
      reportVersion: 1,
    });
    expect(await failure(startWork(asAdmin, next.work_id))).toEqual({
      status: 409,
      code: WORK_ERROR.ALREADY_IN_PROGRESS,
    });
  });
});

describe('작업 관리 mock: 월 목록과 지난 이력', () => {
  it('일일 작업과 합성 지난 이력을 같은 모양으로 날짜 순서로 준다', async () => {
    const today = await openToday();
    await putDailyWorkUnit(asAdmin, TOMORROW);
    const month = await fetchWorkUnits(asAdmin, { from: '2026-11-01', to: '2026-11-30' });

    const daily = month.filter((w) => w.daily);
    expect(daily.map((w) => w.date)).toEqual([TODAY, TOMORROW]);
    expect(daily[0]?.work_id).toBe(today.work_id);

    const past = month.filter((w) => !w.daily);
    expect(new Set(past.map((w) => w.date))).toEqual(new Set(['2026-11-09', '2026-11-10']));
    expect(new Set(past.map((w) => w.progress))).toEqual(new Set(['SUBMITTED', 'ENDED']));
    // 가장 최근 날의 마지막 작업만 제출하지 않았다.
    expect(past.filter((w) => w.progress === 'ENDED').map((w) => w.date)).toEqual(['2026-11-10']);
    expect(
      past.every((w) => w.tbm_report !== null && w.status === 'DONE' && w.actual_ended_at !== null),
    ).toBe(true);
    expect(past.some((w) => w.event_counts !== null)).toBe(true);
    expect(month.map((w) => w.date)).toEqual([...month.map((w) => w.date)].sort());
  });

  it('날짜 범위로 거른다', async () => {
    await openToday();
    const one = await fetchWorkUnits(asAdmin, { from: '2026-11-10', to: '2026-11-10' });
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((w) => w.date === '2026-11-10' && !w.daily)).toBe(true);
    expect(await fetchWorkUnits(asAdmin, { from: '2026-12-01', to: '2026-12-31' })).toEqual([]);
    expect(
      await failure(fetchWorkUnits(asAdmin, { from: '2026-11-30', to: '2026-11-01' })),
    ).toEqual({ status: 400, code: null });
    expect(
      await failure(fetchWorkUnits(asAdmin, { from: '2025-01-01', to: '2026-12-31' })),
    ).toEqual({ status: 400, code: null });
  });

  it('from·to 가 없는 옛 요청(?days=)은 옛 히스토리 mock 이 받는다', async () => {
    const response = await fetch(`${BASE}/api/work-units?days=7`, {
      headers: { Authorization: 'Bearer mock-token.viewer' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { works: { daily?: boolean }[] };
    expect(body.works.length).toBeGreaterThan(0);
    expect(body.works.every((w) => w.daily === undefined)).toBe(true);
  });

  it('지난 이력의 작업·보고서·서명은 읽을 수만 있다', async () => {
    const [work] = (await fetchWorkUnits(asAdmin, { from: '2026-11-09', to: '2026-11-09' })).filter(
      (w) => w.progress === 'SUBMITTED',
    );
    const item = must(work);
    expect((await fetchWorkUnit(asAdmin, item.work_id)).work_id).toBe(item.work_id);
    const { latest } = await fetchReportsByWork(asAdmin, item.work_id);
    const report = must(latest);
    expect(report).toMatchObject({ status: 'SUCCEEDED', draft_status: 'SUCCEEDED' });
    expect(report.submitted_at).not.toBeNull();
    expect(report.submitted_by_name).toBe('김안전');
    expect(formOf(report).info.tasks).toEqual([{ text: item.name }]);
    expect(formOf(report).review.ending).toMatch(
      /^작업 종료 · 총 작업 시간 \d{2}:\d{2}:\d{2}, 사건 \d+건$/,
    );
    const signatures = await fetchSignatures(asAdmin, report.report_id);
    expect(signatures.length).toBeGreaterThanOrEqual(2);
    expect(signatures.length).toBeLessThanOrEqual(4);
    expect(signatures.every((s) => s.image_url.startsWith('data:image/svg+xml'))).toBe(true);
    expect(report.signature_count).toBe(signatures.length);

    const locked = { status: 409, code: WORK_ERROR.REPORT_LOCKED };
    expect(
      await failure(
        saveReportForm(asAdmin, report.report_id, {
          form: formOf(report),
          form_revision: report.form_revision,
        }),
      ),
    ).toEqual(locked);
    expect(await failure(submitReport(asAdmin, report.report_id))).toEqual(locked);
  });
});

describe('작업 관리 mock: 관제가 읽는 작업 목록', () => {
  it('범위 없는 목록이 날짜 작업을 진행 값과 함께 옛 TBM 작업 뒤에 이어 붙여, 세팅이 끝나야 관제가 풀린다', async () => {
    server.resetHandlers(
      ...mock.handlers,
      ...createTbmMock({ deferDaysToHistory: true, dailyWorks: mock.workItems }).handlers,
      ...createHistoryMock({ now }).handlers,
    );
    const work = await openToday();
    const monitorList = () => requestTbmWorks(asAdmin);
    const progressOf = async () =>
      (await monitorList()).find((w) => w.work_id === work.work_id)?.progress;
    const monitorable = async () => hasMonitorableWork(todayWorks(await monitorList(), TODAY));

    expect((await monitorList()).some((w) => w.work_id === '1')).toBe(true);
    expect(await progressOf()).toBe('REPORT');
    expect(await monitorable()).toBe(false);

    const session = startSession(work.work_id);
    expect(await progressOf()).toBe('SETUP');
    expect(await monitorable()).toBe(false);

    finishSession(session);
    expect(await progressOf()).toBe('SETUP_DONE');
    expect(await monitorable()).toBe(true);
  });

  it('날짜 작업 mock 을 잇지 않으면 옛 TBM 작업만 준다', async () => {
    await openToday();
    const list = await requestTbmWorks(asAdmin);
    expect(list.map((w) => w.work_id)).toEqual(['1', '2', '3']);
  });
});

describe('작업 관리 mock: 권한', () => {
  it('로그인하지 않으면 401, 쓰기는 관리자만(아니면 403), 읽기는 열람자도 된다', async () => {
    const work = await openToday();
    const report = await latestOf(work.work_id);
    expect(await failure(putDailyWorkUnit(anonymous, TODAY))).toEqual({ status: 401, code: null });
    expect(await failure(fetchWorkUnits(anonymous, { from: TODAY, to: TODAY }))).toEqual({
      status: 401,
      code: null,
    });
    expect(await failure(putDailyWorkUnit(asViewer, TODAY))).toEqual({ status: 403, code: null });
    expect(await failure(startWork(asViewer, work.work_id))).toEqual({ status: 403, code: null });
    expect(
      await failure(
        saveReportForm(asViewer, report.report_id, { form: formOf(report), form_revision: 0 }),
      ),
    ).toEqual({
      status: 403,
      code: null,
    });
    expect(
      (await fetchWorkUnits(asViewer, { from: TODAY, to: TODAY })).map((w) => w.work_id),
    ).toEqual([work.work_id]);
    expect((await fetchReportsByWork(asViewer, work.work_id)).latest?.report_id).toBe(
      report.report_id,
    );
  });
});

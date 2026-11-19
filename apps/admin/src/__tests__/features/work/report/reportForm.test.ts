import { workReportOf } from '@/__tests__/features/work/workFixture';
import {
  applyEdits,
  blankReportForm,
  circledNumber,
  dateTimeInputValue,
  fieldEditsOf,
  formatDateTime,
  isDrafted,
  isReportLocked,
  isTbmWritten,
  missingKeys,
  parseDateTimeInput,
  reportFormOf,
  selectionOfTasks,
  tasksOfSelection,
  toggleTaskCode,
  withEtcChecked,
  withEtcText,
} from '@/features/work/reportForm';
import { WORK_TASKS, type ReportForm } from '@/features/work/types';
import { describe, expect, it } from 'vitest';

const T0 = new Date(2026, 10, 11, 9, 5).getTime();

/** 작업내용을 넣은 양식. */
const formWith = (tasks: ReportForm['info']['tasks']): ReportForm => {
  const form = blankReportForm(T0);
  return { ...form, info: { ...form.info, tasks } };
};

describe('missingKeys', () => {
  it('작업내용이 비었으면 tasks 가 빠졌다고 알린다', () => {
    expect(missingKeys(blankReportForm(T0))).toEqual(['tasks']);
  });

  it('작업내용이 하나라도 있으면 빠진 칸이 없다(코드·직접 쓴 글 모두)', () => {
    expect(missingKeys(formWith([{ code: 'REBAR' }]))).toEqual([]);
    expect(missingKeys(formWith([{ text: '조적' }]))).toEqual([]);
  });

  it('양식이 없으면(받는 중·예전 방식) 작업내용이 빈 것으로 본다', () => {
    expect(missingKeys(null)).toEqual(['tasks']);
    expect(missingKeys(undefined)).toEqual(['tasks']);
  });

  it('다른 칸이 비어 있어도 막지 않는다(나머지는 세팅 뒤 초안이 채운다)', () => {
    const form = formWith([{ code: 'REBAR' }]);
    expect(form.info.place).toBe('');
    expect(form.focus.risk).toBe('');
    expect(missingKeys(form)).toEqual([]);
  });
});

describe('작업내용 선택 ↔ 양식', () => {
  it('양식의 작업내용을 편집 상태로 바꾼다(코드는 체크, 직접 쓴 글은 기타)', () => {
    expect(selectionOfTasks([])).toEqual({ codes: [], etcChecked: false, etcText: '' });
    expect(selectionOfTasks([{ code: 'REBAR' }, { text: '조적' }, { code: 'FORMWORK' }])).toEqual({
      codes: ['REBAR', 'FORMWORK'],
      etcChecked: true,
      etcText: '조적',
    });
    // 직접 쓴 작업이 여럿이면 쉼표로 이어 한 칸에 담는다.
    expect(selectionOfTasks([{ text: '조적' }, { text: '미장' }]).etcText).toBe('조적, 미장');
  });

  it('항목을 켜고 끈다', () => {
    const none = selectionOfTasks([]);
    const rebar = toggleTaskCode(none, 'REBAR');
    expect(rebar.codes).toEqual(['REBAR']);
    expect(toggleTaskCode(rebar, 'FORMWORK').codes).toEqual(['REBAR', 'FORMWORK']);
    expect(toggleTaskCode(rebar, 'REBAR').codes).toEqual([]);
    expect(none.codes).toEqual([]);
  });

  it('기타 칸에 글을 쓰면 체크가 켜지고, 공백만 쓰면 켜지지 않는다', () => {
    const none = selectionOfTasks([]);
    expect(withEtcText(none, '조적')).toMatchObject({ etcText: '조적', etcChecked: true });
    expect(withEtcText(none, '   ')).toMatchObject({ etcText: '   ', etcChecked: false });
  });

  it('기타 체크를 꺼도 쓴 글은 남고, 글을 지워도 체크는 그대로다', () => {
    const typed = withEtcText(selectionOfTasks([]), '조적');
    const off = withEtcChecked(typed, false);
    expect(off).toMatchObject({ etcText: '조적', etcChecked: false });
    expect(withEtcText(typed, '')).toMatchObject({ etcText: '', etcChecked: true });
  });

  it('편집 상태를 양식의 작업내용으로 만든다: 항목은 목록 순서, 직접 쓴 글은 끝에 하나', () => {
    const selection = withEtcText(
      { codes: ['FLOOR_FINISHING', 'REBAR'], etcChecked: false, etcText: '' },
      ' 조적 ',
    );
    expect(tasksOfSelection(selection, WORK_TASKS)).toEqual([
      { code: 'REBAR' },
      { code: 'FLOOR_FINISHING' },
      { text: '조적' },
    ]);
  });

  it('기타를 켰어도 글이 없으면 넣지 않고, 끈 기타의 글도 넣지 않는다', () => {
    expect(tasksOfSelection({ codes: [], etcChecked: true, etcText: '  ' }, WORK_TASKS)).toEqual(
      [],
    );
    expect(tasksOfSelection({ codes: [], etcChecked: false, etcText: '조적' }, WORK_TASKS)).toEqual(
      [],
    );
  });

  it('목록에 없는 코드는 버리지 않고 뒤에 그대로 둔다(목록을 못 받았을 때도 기존 선택을 지킨다)', () => {
    const selection = selectionOfTasks([{ code: 'NEW_CODE' }, { code: 'REBAR' }]);
    expect(tasksOfSelection(selection, WORK_TASKS)).toEqual([
      { code: 'REBAR' },
      { code: 'NEW_CODE' },
    ]);
    expect(tasksOfSelection(selection, [])).toEqual([{ code: 'NEW_CODE' }, { code: 'REBAR' }]);
  });
});

describe('applyEdits', () => {
  const drafted = (): ReportForm => ({
    info: {
      date_time_ms: T0,
      same_day: true,
      task_name: '철근 배근',
      tasks: [{ code: 'REBAR' }],
      place: '개구부 위험 구역',
      risk_assessed: true,
    },
    risks: [
      { risk: '개구부 추락', measure: '덮개 설치' },
      { risk: '', measure: '' },
      { risk: '', measure: '' },
    ],
    focus: { risk: '개구부 추락', measure: '덮개 설치' },
    checks: blankReportForm(T0).checks.map((row, i) => ({
      ...row,
      yes: i === 2 ? false : true,
      action: i === 2 ? '덮개 설치 전까지 접근 통제' : '',
    })),
    review: { daily: '위험구역 확인', ending: '' },
  });

  it('초안 전(fields 없음)에는 작업내용만 바뀌고 나머지는 받은 그대로다', () => {
    const base = blankReportForm(T0);
    const next = applyEdits(
      base,
      { tasks: selectionOfTasks([{ code: 'REBAR' }, { text: '조적' }]) },
      WORK_TASKS,
    );
    expect(next.info.tasks).toEqual([{ code: 'REBAR' }, { text: '조적' }]);
    // 작업내용을 처음 고르는 저장이라 일시만 TBM 을 쓴 시각으로 바뀐다(-734, 아래 describe)
    expect(next.info.date_time_ms).not.toBe(T0);
    expect({ ...next, info: { ...next.info, tasks: [], date_time_ms: T0 } }).toEqual(base);
    // 받은 양식은 건드리지 않는다.
    expect(base.info.tasks).toEqual([]);
  });

  it('초안 뒤에는 고친 칸을 모두 입히고 글은 앞뒤 공백을 지운다', () => {
    const base = drafted();
    const fields = fieldEditsOf(base);
    fields.place = '  3층 슬래브  ';
    fields.sameDay = false;
    fields.risks[1] = { risk: ' 낙하물 ', measure: ' 방호망 ' };
    fields.focus.measure = '덮개 고정';
    fields.review.ending = ' 이상 없음 ';
    const next = applyEdits(base, { tasks: selectionOfTasks(base.info.tasks), fields }, WORK_TASKS);

    expect(next.info).toMatchObject({
      place: '3층 슬래브',
      same_day: false,
      task_name: '철근 배근',
    });
    expect(next.risks[1]).toEqual({ risk: '낙하물', measure: '방호망' });
    expect(next.focus).toEqual({ risk: '개구부 추락', measure: '덮개 고정' });
    expect(next.review).toEqual({ daily: '위험구역 확인', ending: '이상 없음' });
  });

  it("점검의 조치 내용은 '아니오' 일 때만 남긴다", () => {
    const base = drafted();
    const fields = fieldEditsOf(base);
    fields.checks[2] = { ...fields.checks[2]!, yes: true };
    fields.checks[0] = { ...fields.checks[0]!, yes: false, action: ' 보호구 지급 ' };
    const next = applyEdits(base, { tasks: selectionOfTasks(base.info.tasks), fields }, WORK_TASKS);
    expect(next.checks[2]).toMatchObject({ code: 'OPENING_GUARD', yes: true, action: '' });
    expect(next.checks[0]).toMatchObject({ code: 'PPE', yes: false, action: '보호구 지급' });
  });

  it('일시를 고치지 않았으면 원래 값(분 아래까지)을 지키고, 고쳤으면 입력 값으로 바꾼다', () => {
    const exact = T0 + 23_456;
    const base = { ...drafted(), info: { ...drafted().info, date_time_ms: exact } };
    const untouched = applyEdits(
      base,
      { tasks: selectionOfTasks(base.info.tasks), fields: fieldEditsOf(base) },
      WORK_TASKS,
    );
    expect(untouched.info.date_time_ms).toBe(exact);

    const fields = fieldEditsOf(base);
    fields.dateTime = '2026-11-11T10:30';
    const edited = applyEdits(
      base,
      { tasks: selectionOfTasks(base.info.tasks), fields },
      WORK_TASKS,
    );
    expect(edited.info.date_time_ms).toBe(new Date(2026, 10, 11, 10, 30).getTime());

    fields.dateTime = '';
    expect(
      applyEdits(base, { tasks: selectionOfTasks(base.info.tasks), fields }, WORK_TASKS).info
        .date_time_ms,
    ).toBeNull();
  });

  it('편집 창이 처음 보여 줄 칸은 원본과 따로 복사한 것이다', () => {
    const base = drafted();
    const fields = fieldEditsOf(base);
    fields.risks[0]!.risk = '바뀜';
    fields.checks[0]!.action = '바뀜';
    expect(base.risks[0]!.risk).toBe('개구부 추락');
    expect(base.checks[0]!.action).toBe('');
  });
});

describe('일시 글', () => {
  it('ms 를 YYYY-MM-DD HH:mm 으로 바꾼다(현장 시각)', () => {
    expect(formatDateTime(T0)).toBe('2026-11-11 09:05');
    expect(formatDateTime(new Date(2026, 0, 2, 0, 0).getTime())).toBe('2026-01-02 00:00');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });

  it('입력 칸 값과 서로 바뀐다', () => {
    expect(dateTimeInputValue(T0)).toBe('2026-11-11T09:05');
    expect(dateTimeInputValue(null)).toBe('');
    expect(parseDateTimeInput('2026-11-11T09:05')).toBe(new Date(2026, 10, 11, 9, 5).getTime());
    expect(parseDateTimeInput('')).toBeNull();
    expect(parseDateTimeInput('2026-11-11 09:05')).toBeNull();
    expect(parseDateTimeInput(dateTimeInputValue(T0))).toBe(new Date(2026, 10, 11, 9, 5).getTime());
  });
});

describe('보고서 상태 도우미', () => {
  it('초안 칸이 채워졌거나 채워질 일이 없어졌을 때만 초안이 끝난 것이다', () => {
    expect(isDrafted(null)).toBe(false);
    expect(isDrafted(undefined)).toBe(false);
    expect(isDrafted(workReportOf({ draft_status: null }))).toBe(false);
    expect(isDrafted(workReportOf({ draft_status: 'GENERATING' }))).toBe(false);
    expect(isDrafted(workReportOf({ draft_status: 'SUCCEEDED' }))).toBe(true);
    expect(isDrafted(workReportOf({ draft_status: 'FAILED' }))).toBe(true);
  });

  it('제출했거나 잠겼으면 잠긴 보고서다', () => {
    expect(isReportLocked(workReportOf())).toBe(false);
    expect(isReportLocked(workReportOf({ locked_at: 1 }))).toBe(true);
    expect(isReportLocked(workReportOf({ submitted_at: 1 }))).toBe(true);
  });

  it('보고서에 양식이 없으면 빈 양식을 준다', () => {
    const form = formWith([{ code: 'REBAR' }]);
    expect(reportFormOf(workReportOf({ form }))).toBe(form);
    expect(reportFormOf(workReportOf({ form: null }))).toEqual(blankReportForm(null));
    expect(reportFormOf(null)).toEqual(blankReportForm(null));
  });

  it('잠재위험 번호는 동그라미 숫자다', () => {
    expect([0, 1, 2].map(circledNumber)).toEqual(['①', '②', '③']);
    expect(circledNumber(10)).toBe('11');
  });
});

describe('TBM 일시는 작업이 생긴 시각이 아니라 TBM 을 쓴 시각이다(-734)', () => {
  const CREATED = new Date(2026, 10, 11, 0, 9).getTime();
  const WRITTEN = new Date(2026, 10, 11, 16, 17).getTime();

  it('작업내용이 비어 있는 동안은 아직 쓰지 않은 양식이다', () => {
    expect(isTbmWritten(blankReportForm(CREATED))).toBe(false);
    expect(isTbmWritten(formWith([{ code: 'REBAR' }]))).toBe(true);
  });

  it('작업내용을 처음 고르는 저장(초안 전)이 일시를 지금 시각으로 바꾼다', () => {
    const base = blankReportForm(CREATED);
    const next = applyEdits(
      base,
      { tasks: selectionOfTasks([{ code: 'REBAR' }]) },
      WORK_TASKS,
      WRITTEN,
    );
    expect(next.info.date_time_ms).toBe(WRITTEN);
    expect(base.info.date_time_ms).toBe(CREATED);
  });

  it('작업내용을 고르지 않은 저장은 일시를 건드리지 않는다', () => {
    const base = blankReportForm(CREATED);
    const next = applyEdits(base, { tasks: selectionOfTasks([]) }, WORK_TASKS, WRITTEN);
    expect(next.info.date_time_ms).toBe(CREATED);
  });

  it('이미 쓴 TBM 을 다시 저장해도 쓴 시각을 지킨다(초안 전·후 모두)', () => {
    const written = {
      ...formWith([{ code: 'REBAR' }]),
      info: { ...formWith([{ code: 'REBAR' }]).info, date_time_ms: WRITTEN },
    };
    const later = WRITTEN + 3_600_000;
    expect(
      applyEdits(written, { tasks: selectionOfTasks([{ code: 'REBAR' }]) }, WORK_TASKS, later).info
        .date_time_ms,
    ).toBe(WRITTEN);
    expect(
      applyEdits(
        written,
        { tasks: selectionOfTasks([{ code: 'REBAR' }]), fields: fieldEditsOf(written) },
        WORK_TASKS,
        later,
      ).info.date_time_ms,
    ).toBe(WRITTEN);
  });

  it('초안 뒤 편집 창에서 처음 작업내용을 골라도 일시 칸을 고치지 않았으면 지금 시각이고, 고쳤으면 그 값이 먼저다', () => {
    const base = blankReportForm(CREATED);
    const untouched = applyEdits(
      base,
      { tasks: selectionOfTasks([{ code: 'REBAR' }]), fields: fieldEditsOf(base) },
      WORK_TASKS,
      WRITTEN,
    );
    expect(untouched.info.date_time_ms).toBe(WRITTEN);

    const fields = fieldEditsOf(base);
    fields.dateTime = '2026-11-11T10:30';
    const edited = applyEdits(
      base,
      { tasks: selectionOfTasks([{ code: 'REBAR' }]), fields },
      WORK_TASKS,
      WRITTEN,
    );
    expect(edited.info.date_time_ms).toBe(new Date(2026, 10, 11, 10, 30).getTime());
  });
});

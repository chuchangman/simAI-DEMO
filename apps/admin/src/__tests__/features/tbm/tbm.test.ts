import { readTbmWorks } from '@/features/tbm/api';
import {
  createTask,
  inputToWorkUnitBody,
  nextTaskId,
  TASK_INPUT_DEFAULT,
  taskInputValid,
  taskToInput,
} from '@/features/tbm/taskInput';
import {
  fromMin,
  interferencesOf,
  itemRects,
  overlapsTime,
  rectAnd,
  rectHit,
  taskPeak,
  taskPlace,
  tbmInterferences,
  toMin,
} from '@/features/tbm/tbm';
import { TBM_TASKS, type TbmTask } from '@/features/tbm/tbmDemo';
import {
  isFallbackApiError,
  tbmFailureReasonText,
  tbmReportRequestErrorText,
} from '@/features/tbm/types';
import { storedPlaceOf } from '@/features/tbm/workPlace';
import { ApiError, NETWORK_ERROR } from '@/lib/http';
import { describe, expect, it } from 'vitest';

const [T1, T2, T3] = TBM_TASKS as [TbmTask, TbmTask, TbmTask];

const task = (over: Partial<TbmTask>): TbmTask => ({
  id: 'T9',
  name: '시험 작업',
  from: '09:00',
  to: '10:00',
  zone: null,
  people: 1,
  lead: 'A조',
  gear: '장비 없음',
  items: [],
  evals: [],
  measures: [],
  ...over,
});

describe('시간대', () => {
  it('HH:MM 과 분을 오간다', () => {
    expect(toMin('09:30')).toBe(570);
    expect(fromMin(570)).toBe('09:30');
    expect(fromMin(toMin('00:05'))).toBe('00:05');
  });

  it('겹치는 시간대만 겹친다고 본다(끝과 시작이 맞닿으면 겹치지 않는다)', () => {
    expect(overlapsTime(T1, T2)).toBe(true);
    expect(overlapsTime(T1, T3)).toBe(false);
    expect(overlapsTime({ from: '12:00', to: '13:00' }, { from: '13:00', to: '14:00' })).toBe(
      false,
    );
  });
});

describe('배치 겹침', () => {
  it('동선은 구간마다 폭만큼 넓힌 직사각형이다', () => {
    const rects = itemRects({
      kind: 'path',
      label: '동선',
      w: 1,
      pts: [
        [0, 0],
        [0, 2],
        [3, 2],
      ],
    });
    expect(rects).toEqual([
      { x: -0.5, y: -0.5, w: 1, h: 3 },
      { x: -0.5, y: 1.5, w: 4, h: 1 },
    ]);
  });

  it('변만 닿으면 겹치지 않고, 겹친 부분을 구한다', () => {
    const a = { x: 0, y: 0, w: 2, h: 2 };
    expect(rectHit(a, { x: 2, y: 0, w: 1, h: 1 })).toBe(false);
    expect(rectHit(a, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectAnd(a, { x: 1, y: 1, w: 2, h: 2 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });
});

describe('동시 작업 간섭', () => {
  it('가짜 작업 셋에서는 T1 비계와 T2 지게차 동선이 겹치는 한 건이다', () => {
    const all = tbmInterferences(TBM_TASKS);
    expect(all).toHaveLength(1);
    const [hit] = all;
    expect(hit).toMatchObject({
      a: 'T1',
      b: 'T2',
      from: '10:00',
      to: '11:30',
      sev: 'HIGH',
      why: '비계 S1 ↔ 지게차 동선 겹침',
    });
    expect(hit!.spot!.x).toBeCloseTo(5.6);
    expect(hit!.spot!.y).toBeCloseTo(2.55);
    expect(hit!.spot!.w).toBeCloseTo(1);
    expect(hit!.spot!.h).toBeCloseTo(0.9);
    expect(interferencesOf(all, 'T2')).toHaveLength(1);
    expect(interferencesOf(all, 'T3')).toHaveLength(0);
  });

  it('배치가 안 겹쳐도 같은 구역 같은 시간대면 CAUTION, 시간대가 안 겹치면 간섭이 아니다', () => {
    const a = task({ id: 'A', zone: 'z-02', area: '단상 구역', from: '09:00', to: '11:00' });
    const b = task({ id: 'B', zone: 'z-02', area: '단상 구역', from: '10:00', to: '12:00' });
    const c = task({ id: 'C', zone: 'z-02', area: '단상 구역', from: '11:00', to: '12:00' });
    const all = tbmInterferences([a, b, c]);
    expect(all).toEqual([
      {
        a: 'A',
        b: 'B',
        from: '10:00',
        to: '11:00',
        sev: 'CAUTION',
        why: '단상 구역에서 동시 작업',
        spot: null,
      },
      {
        a: 'B',
        b: 'C',
        from: '11:00',
        to: '12:00',
        sev: 'CAUTION',
        why: '단상 구역에서 동시 작업',
        spot: null,
      },
    ]);
  });

  it('가장 높은 평가 등급을 고르고, 평가가 없으면 null 이다', () => {
    expect(taskPeak(T1)).toBe('CRITICAL');
    expect(taskPeak(T3)).toBe('CAUTION');
    expect(taskPeak(task({}))).toBeNull();
  });

  it('구역 작업은 구역 이름(번호 없이), 구역 없는 작업은 적어 둔 장소 또는 현장 전체를 보인다', () => {
    expect(taskPlace(T1)).toBe('개구부 구역');
    expect(taskPlace(T3)).toBe('북서쪽 바닥');
    expect(taskPlace(task({}))).toBe('현장 전체');
  });
});

describe('작업 등록 · 수정 변환 및 오류 문구', () => {
  it('이름이 있고 끝이 시작보다 늦어야 한다', () => {
    expect(taskInputValid(TASK_INPUT_DEFAULT)).toBe(false);
    expect(taskInputValid({ ...TASK_INPUT_DEFAULT, name: '전기 배선' })).toBe(true);
    expect(taskInputValid({ ...TASK_INPUT_DEFAULT, name: ' ' })).toBe(false);
    expect(
      taskInputValid({ ...TASK_INPUT_DEFAULT, name: '전기 배선', from: '15:00', to: '15:00' }),
    ).toBe(false);
  });

  it('다음 번호로 만들고, 구역이 없으면 현장 전체다', () => {
    expect(nextTaskId(TBM_TASKS)).toBe('T4');
    expect(nextTaskId([])).toBe('T1');
    const created = createTask(TBM_TASKS, {
      ...TASK_INPUT_DEFAULT,
      name: ' 전기 배선 ',
      zone: '',
      people: '0',
      workType: 'OPENING_WORK',
      layoutId: '102',
    });
    expect(created).toMatchObject({
      id: 'T4',
      name: '전기 배선',
      zone: null,
      area: '현장 전체',
      people: 1,
      gear: '장비 미입력',
      workType: 'OPENING_WORK',
      layoutId: 102,
      items: [],
      evals: [],
    });
    // 등록 폼은 구역을 받지 않는다(구역은 세팅 뒤 구역 단계에서 그린다): 처음 값은 구역 없음이다.
    expect(createTask(TBM_TASKS, { ...TASK_INPUT_DEFAULT, name: 'a' })).toMatchObject({
      zone: null,
      area: '현장 전체',
      people: 2,
      lead: '',
    });
    // 구역을 주면 이름을 모르므로 이름 없는 구역 글자다(번호는 보이지 않는다).
    expect(createTask(TBM_TASKS, { ...TASK_INPUT_DEFAULT, name: 'a', zone: 'z-02' })).toMatchObject(
      {
        zone: 'z-02',
        area: '구역',
      },
    );
    expect(createTask(TBM_TASKS, { ...TASK_INPUT_DEFAULT, name: 'a' }, '2026-11-06')).toMatchObject(
      {
        date: '2026-11-06',
      },
    );
  });

  it('TaskInput 과 WorkUnitWriteBody 를 서로 변환한다', () => {
    const input = taskToInput(T1);
    expect(input).toMatchObject({
      name: T1.name,
      from: '09:00',
      to: '12:00',
      zone: 'z-04',
      people: '4',
      lead: 'A조',
      workType: 'OPENING_WORK',
      layoutId: '1',
    });
    const body = inputToWorkUnitBody({
      ...input,
      workType: 'SCAFFOLD_INSTALL',
      layoutId: '101',
    });
    expect(body).toMatchObject({
      name: T1.name,
      zone_id: 'z-04',
      planned_people: 4,
      lead: 'A조',
      work_type: 'SCAFFOLD_INSTALL',
      layout_id: 101,
    });
  });

  it('구역 없는 작업은 장소를 비워 보내고, 수정은 적어 둔 장소만 돌려보낸다(현장 전체 글자는 저장하지 않는다)', () => {
    const input = { ...TASK_INPUT_DEFAULT, name: '전기 배선' };
    expect(inputToWorkUnitBody(input).place).toBeNull();
    expect(inputToWorkUnitBody(input, '2026-11-06', storedPlaceOf(T3)).place).toBe('북서쪽 바닥');
    expect(inputToWorkUnitBody(input, '2026-11-06', storedPlaceOf(task({}))).place).toBeNull();
    expect(
      inputToWorkUnitBody({ ...input, zone: 'z-04' }, '2026-11-06', '북서쪽 바닥').place,
    ).toBeNull();
  });

  it('409 · FAILED · 폴백 오류를 올바르게 구분한다', () => {
    const noLayoutErr = new ApiError(409, {
      kind: 'HTTP',
      code: 'WORK_HAS_NO_LAYOUT',
      serverMessage: '레이아웃 없음',
    });
    const inProgressErr = new ApiError(409, {
      kind: 'HTTP',
      code: 'REPORT_IN_PROGRESS',
      serverMessage: '생성 중',
    });
    const netErr = new ApiError(NETWORK_ERROR, { kind: 'NETWORK' });
    const serverErr = new ApiError(503, { kind: 'HTTP' });

    const noLayoutText = tbmReportRequestErrorText(noLayoutErr);
    expect(noLayoutText).toContain('가상 레이아웃에 위험 요소(개구부 등)를 먼저 배치·저장하세요');
    expect(noLayoutText).toContain('구역 화면의 개구부(관제 구역)');
    expect(noLayoutText).toContain('TBM 가상 레이아웃');
    expect(noLayoutText).not.toContain('WORK_HAS_NO_LAYOUT');
    expect(tbmReportRequestErrorText(inProgressErr)).toContain('REPORT_IN_PROGRESS');
    expect(tbmFailureReasonText('CITATION_VIOLATION')).toContain('CITATION_VIOLATION');
    expect(isFallbackApiError(netErr)).toBe(true);
    expect(isFallbackApiError(serverErr)).toBe(true);
    expect(isFallbackApiError(noLayoutErr)).toBe(false);
  });
});

describe('작업 목록 읽기(진행 값)', () => {
  const raw = (patch: Record<string, unknown> = {}) => ({
    work_id: 7,
    date: '2026-11-12',
    name: '작업',
    from_ms: 1,
    to_ms: 2,
    planned_people: 1,
    ...patch,
  });

  it('서버가 준 진행 값을 그대로 읽는다', () => {
    expect(readTbmWorks([raw({ progress: 'SETUP_DONE' })])[0]?.progress).toBe('SETUP_DONE');
  });

  it('진행 값이 없는 응답(옛 서버·옛 mock)도 작업으로 읽는다', () => {
    const [work] = readTbmWorks([raw()]);
    expect(work?.work_id).toBe('7');
    expect(work?.progress ?? null).toBeNull();
  });

  it('모르는 진행 값이 와도 작업을 버리지 않고 모름(null)으로 읽는다', () => {
    const [work] = readTbmWorks([raw({ status: 'IN_PROGRESS', progress: 'PAUSED' })]);
    expect(work?.status).toBe('IN_PROGRESS');
    expect(work?.progress).toBeNull();
  });
});

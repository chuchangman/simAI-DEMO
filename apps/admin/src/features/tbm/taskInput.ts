import { GEAR_UNSET_TEXT, MAX_PEOPLE, MIN_PEOPLE } from '@/features/tbm/constants';
import { toMin } from '@/features/tbm/tbm';
import { type TbmTask } from '@/features/tbm/tbmDemo';
import { dateHhmmToMs, type WorkUnitWriteBody } from '@/features/tbm/types';
import { workPlaceLabel } from '@/features/tbm/workPlace';

// 작업 등록·수정(수동 입력). 입력값 검사와 새 작업 만들기를 화면 없이 한다.

export interface TaskInput {
  name: string;
  from: string;
  to: string;
  /** 빈 글자면 구역이 없는(현장 전체) 작업이다. */
  zone: string;
  people: string;
  lead: string;
  /** 공종 코드(work_type). 빈 글자면 미지정(null). */
  workType?: string;
  /** 연결할 가상 레이아웃 ID(layout_id). 빈 글자면 연결 안 함(null). */
  layoutId?: string;
}

/** 등록 창을 열 때 채워 두는 값. */
export const TASK_INPUT_DEFAULT: TaskInput = {
  name: '',
  from: '13:00',
  to: '15:00',
  zone: '',
  people: '2',
  lead: '',
  workType: 'GENERAL',
  layoutId: '',
};

/** 이름이 있고 끝 시각이 시작보다 늦어야 등록할 수 있다. */
export const taskInputValid = (input: TaskInput) =>
  input.name.trim() !== '' &&
  input.from !== '' &&
  input.to !== '' &&
  toMin(input.from) < toMin(input.to);

/** 다음 작업 번호(T1, T2 … 중 가장 큰 번호 + 1). */
export function nextTaskId(tasks: readonly Pick<TbmTask, 'id'>[]): string {
  const max = tasks.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0);
  return `T${max + 1}`;
}

/** 입력한 인원을 정수로 고르고 한도 안으로 맞춘다. 숫자가 아니면 최소 인원이다. */
export function clampPeople(text: string): number {
  const people = Math.round(Number(text));
  return Number.isFinite(people) && people >= MIN_PEOPLE
    ? Math.min(people, MAX_PEOPLE)
    : MIN_PEOPLE;
}

/** 기존 작업을 수정 모달 초기값으로 바꾼다. */
export function taskToInput(task: TbmTask): TaskInput {
  return {
    name: task.name,
    from: task.from,
    to: task.to,
    zone: task.zone ?? '',
    people: String(task.people),
    lead: task.lead,
    workType: task.workType ?? '',
    layoutId: task.layoutId !== null && task.layoutId !== undefined ? String(task.layoutId) : '',
  };
}

/** 이 브라우저(현장) 시각의 오늘 날짜 YYYY-MM-DD. 서버 작업 날짜 기본값. */
export function todayIsoDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * TaskInput 을 POST/PUT /api/work-units 요청 본문으로 바꾼다. place 는 구역 없는 작업이 이미 가진 장소(storedPlaceOf)를
 * 수정 때 그대로 돌려보내는 자리다(수정은 전체 교체라 안 보내면 지워진다). 새 작업은 비워 둔다.
 */
export function inputToWorkUnitBody(
  input: TaskInput,
  date: string = todayIsoDate(),
  place: string | null = null,
): WorkUnitWriteBody {
  const layoutNum = input.layoutId && input.layoutId.trim() !== '' ? Number(input.layoutId) : null;
  return {
    date,
    name: input.name.trim(),
    from_ms: dateHhmmToMs(date, input.from),
    to_ms: dateHhmmToMs(date, input.to),
    zone_id: input.zone || null,
    place: input.zone ? null : place,
    planned_people: clampPeople(input.people),
    lead: input.lead.trim() || null,
    layout_id: layoutNum !== null && Number.isFinite(layoutNum) ? layoutNum : null,
    work_type: input.workType && input.workType.trim() !== '' ? input.workType.trim() : null,
  };
}

/** 수동 입력으로 작업을 만든다(date 는 작업 날짜 YYYY-MM-DD). 배치·평가는 아직 없다. */
export function createTask(tasks: readonly TbmTask[], input: TaskInput, date?: string): TbmTask {
  const layoutNum = input.layoutId && input.layoutId.trim() !== '' ? Number(input.layoutId) : null;
  return {
    id: nextTaskId(tasks),
    ...(date ? { date } : {}),
    name: input.name.trim(),
    from: input.from,
    to: input.to,
    zone: input.zone || null,
    area: workPlaceLabel({ zone_id: input.zone || null }),
    people: clampPeople(input.people),
    lead: input.lead,
    gear: GEAR_UNSET_TEXT,
    layoutId: layoutNum !== null && Number.isFinite(layoutNum) ? layoutNum : null,
    workType: input.workType && input.workType.trim() !== '' ? input.workType.trim() : null,
    items: [],
    evals: [],
    measures: [],
  };
}

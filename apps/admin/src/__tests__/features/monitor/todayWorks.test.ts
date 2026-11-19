import { hasMonitorableWork, standbyKindOf, todayWorks } from '@/features/monitor/todayWorks';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { describe, expect, it } from 'vitest';

const TODAY = '2026-11-05';

const work = (patch: Partial<TbmWorkUnit> = {}): TbmWorkUnit => ({
  work_id: '1',
  status: 'PLANNED',
  date: TODAY,
  name: '작업',
  from_ms: 100,
  to_ms: 200,
  zone_id: null,
  place: null,
  planned_people: 1,
  lead: null,
  layout_id: null,
  work_type: null,
  ...patch,
});

describe('오늘 작업', () => {
  it('오늘 날짜의 작업과 날짜와 상관없이 진행 중인 작업만 남긴다', () => {
    const list = [
      work({ work_id: 'today' }),
      work({ work_id: 'yesterday', date: '2026-11-04' }),
      work({ work_id: 'tomorrow', date: '2026-11-06' }),
      work({ work_id: 'running-yesterday', date: '2026-11-04', status: 'IN_PROGRESS' }),
      work({ work_id: 'done-today', status: 'DONE' }),
      work({ work_id: 'done-yesterday', date: '2026-11-04', status: 'DONE' }),
    ];
    expect(
      todayWorks(list, TODAY)
        .map((w) => w.work_id)
        .sort(),
    ).toEqual(['done-today', 'running-yesterday', 'today']);
  });

  it('상태를 모르는 오늘 작업도 남는다', () => {
    expect(todayWorks([work({ status: undefined })], TODAY)).toHaveLength(1);
  });
});

describe('관제할 작업(대기 화면 판정)', () => {
  it('작업이 없거나 모두 끝났으면 관제할 작업이 없다', () => {
    expect(hasMonitorableWork([])).toBe(false);
    expect(
      hasMonitorableWork([
        work({ status: 'DONE', progress: 'ENDED' }),
        work({ status: 'DONE', progress: 'SUBMITTED' }),
      ]),
    ).toBe(false);
  });

  it.each(['REPORT', 'SETUP'] as const)(
    '진행 값이 %s 인 예정 작업은 세팅이 끝나기 전이라 관제할 작업이 아니다',
    (progress) => {
      expect(hasMonitorableWork([work({ status: 'PLANNED', progress })])).toBe(false);
    },
  );

  it('세팅을 마친(SETUP_DONE) 예정 작업은 관제할 작업이다', () => {
    expect(hasMonitorableWork([work({ status: 'PLANNED', progress: 'SETUP_DONE' })])).toBe(true);
  });

  it('작업 중이면 진행 값을 몰라도 관제할 작업이다', () => {
    expect(hasMonitorableWork([work({ status: 'IN_PROGRESS' })])).toBe(true);
    expect(hasMonitorableWork([work({ status: 'IN_PROGRESS', progress: null })])).toBe(true);
    expect(hasMonitorableWork([work({ status: 'IN_PROGRESS', progress: 'IN_PROGRESS' })])).toBe(
      true,
    );
  });

  it('끝난 작업(DONE)은 진행 값이 무엇이든 관제할 작업이 아니다', () => {
    expect(hasMonitorableWork([work({ status: 'DONE', progress: 'SETUP_DONE' })])).toBe(false);
  });

  it('상태와 진행 값을 모두 모르는 작업은 관제할 작업으로 보지 않는다(잠근 채로 둔다)', () => {
    expect(hasMonitorableWork([work({ status: undefined })])).toBe(false);
    expect(hasMonitorableWork([work({ status: undefined, progress: null })])).toBe(false);
  });

  it('여러 작업 중 하나라도 관제할 작업이면 있다고 본다', () => {
    expect(
      hasMonitorableWork([
        work({ status: 'DONE', progress: 'ENDED' }),
        work({ status: 'PLANNED', progress: 'REPORT' }),
        work({ status: 'PLANNED', progress: 'SETUP_DONE' }),
      ]),
    ).toBe(true);
  });
});

describe('대기 화면 종류', () => {
  it('관제할 작업이 있으면 대기가 아니다', () => {
    expect(standbyKindOf([work({ status: 'IN_PROGRESS', progress: 'IN_PROGRESS' })])).toBeNull();
  });

  it('오늘 작업이 모두 끝났으면(종료·제출) 작업이 끝남이다', () => {
    expect(
      standbyKindOf([
        work({ status: 'DONE', progress: 'ENDED' }),
        work({ work_id: '2', status: 'DONE', progress: 'SUBMITTED' }),
      ]),
    ).toBe('ended');
  });

  it('작업이 없거나 세팅 전인 작업이 남았으면 세팅 전이다', () => {
    expect(standbyKindOf([])).toBe('setup');
    expect(
      standbyKindOf([
        work({ status: 'DONE', progress: 'SUBMITTED' }),
        work({ work_id: '2', progress: 'REPORT' }),
      ]),
    ).toBe('setup');
  });
});

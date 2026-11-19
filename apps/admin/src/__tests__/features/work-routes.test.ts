import { Route as HistoryRoute } from '@/routes/_app/history.$workId';
import { Route as HistoryIndexRoute } from '@/routes/_app/history.index';
import { Route as SetupRoute } from '@/routes/_app/setup';
import { Route as TbmRoute } from '@/routes/_app/tbm';
import { Route as WorkRoute } from '@/routes/_app/work';
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

// /tbm·/history 는 /work 로 넘기고, /work(date·workUnitId)·/setup(workUnitId)의 검색 값을 검사한다.
describe('작업 관리 라우트', () => {
  it.each([
    ['/tbm', TbmRoute],
    ['/history', HistoryIndexRoute],
    ['/history/$workId', HistoryRoute],
  ])('%s 는 /work 로 넘긴다', (_path, route) => {
    const beforeLoad = route.options.beforeLoad as (ctx: unknown) => void;
    let thrown: unknown;
    try {
      beforeLoad({});
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/work');
  });

  it('/work 는 date 를 YYYY-MM-DD 로 검증하고 잘못되면 없는 값이다', () => {
    const validate = WorkRoute.options.validateSearch as (s: Record<string, unknown>) => unknown;
    expect(validate({ date: '2026-11-11' })).toEqual({ date: '2026-11-11', workUnitId: undefined });
    expect(validate({ date: ' 2026-11-11 ' })).toEqual({
      date: '2026-11-11',
      workUnitId: undefined,
    });
    // 형식이 틀리거나 없는 날짜(2월 30일)·글자가 아닌 값은 무시한다.
    expect(validate({ date: '2026-02-30' })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({ date: '2026-1-5' })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({ date: 'abc' })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({ date: 20261111 })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({})).toEqual({ date: undefined, workUnitId: undefined });
  });

  it('/work 는 workUnitId 를 숫자 문자열로 받고 비거나 숫자가 아니면 없는 값이다', () => {
    const validate = WorkRoute.options.validateSearch as (s: Record<string, unknown>) => unknown;
    expect(validate({ workUnitId: '7' })).toEqual({ date: undefined, workUnitId: '7' });
    expect(validate({ workUnitId: 7 })).toEqual({ date: undefined, workUnitId: '7' });
    expect(validate({ workUnitId: '' })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({ workUnitId: 'abc' })).toEqual({ date: undefined, workUnitId: undefined });
    expect(validate({ date: '2026-11-11', workUnitId: '9001' })).toEqual({
      date: '2026-11-11',
      workUnitId: '9001',
    });
  });

  it('/setup 은 양의 정수 workUnitId 만 받고 없으면 없는 값이다(기본값 1 을 쓰지 않는다)', () => {
    const validate = SetupRoute.options.validateSearch as (s: Record<string, unknown>) => unknown;
    expect(validate({ workUnitId: '12' })).toEqual({ workUnitId: 12 });
    expect(validate({ workUnitId: 0 })).toEqual({ workUnitId: undefined });
    expect(validate({ workUnitId: 'abc' })).toEqual({ workUnitId: undefined });
    expect(validate({})).toEqual({ workUnitId: undefined });
  });
});

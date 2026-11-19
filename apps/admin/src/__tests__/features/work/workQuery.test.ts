import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { invalidateAfterRun } from '@/features/work/workQuery';
import { openDayKey, workReportsKey } from '@/lib/queryKeys';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 시작·종료 뒤 캐시를 새로 받는 순서: 보고서(종료 미팅 채우는 중 표시)가 먼저 도착해야 하루 작업(ENDED)이 낡은 보고서로 화면을 열지 않는다.
// 관제가 보는 작업 목록(TBM_WORKS_KEY)도 15초 주기를 기다리지 않고 바로 다시 받는다.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const observers: (() => void)[] = [];
afterEach(() => {
  observers.splice(0).forEach((unsubscribe) => unsubscribe());
});

/** 키 하나를 구독해 두고, 요청이 시작·끝날 때 기록하는 쿼리. 처음 받기는 끝난 뒤 돌려준다. */
async function observe(
  client: QueryClient,
  queryKey: readonly unknown[],
  name: string,
  log: string[],
  delayMs = 0,
) {
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: async () => {
      log.push(`${name} 시작`);
      await sleep(delayMs);
      log.push(`${name} 끝`);
      return name;
    },
  });
  observers.push(observer.subscribe(() => undefined));
  await vi.waitFor(() => expect(log).toContain(`${name} 끝`));
}

describe('invalidateAfterRun', () => {
  it('보고서를 다 받은 뒤에 하루 작업을 받는다(보고서가 느려도)', async () => {
    const client = new QueryClient();
    const log: string[] = [];
    await observe(client, workReportsKey('9001'), '보고서', log, 40);
    await observe(client, openDayKey('2026-11-11'), '하루 작업', log);
    log.length = 0;

    await invalidateAfterRun(client);

    expect(log.indexOf('하루 작업 시작')).toBeGreaterThan(log.indexOf('보고서 끝'));
  });

  it('관제가 보는 작업 목록도 바로 다시 받는다(15초 주기를 기다리지 않는다)', async () => {
    const client = new QueryClient();
    const log: string[] = [];
    await observe(client, TBM_WORKS_KEY, '작업 목록', log);
    log.length = 0;

    await invalidateAfterRun(client);

    expect(log).toContain('작업 목록 끝');
  });
});

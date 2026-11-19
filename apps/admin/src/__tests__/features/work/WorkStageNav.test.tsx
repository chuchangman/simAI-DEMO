import { WorkStageNav } from '@/features/work/WorkStageNav';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

const itemOf = (label: string) => screen.getByText(label).closest('li');
const stateOf = (label: string) => itemOf(label)?.getAttribute('data-state');

describe('WorkStageNav', () => {
  it('네 단계 이름을 순서대로 보이고, 지난 단계는 완료·지금 단계는 현재·남은 단계는 대기로 가른다', () => {
    render(<WorkStageNav stage="preflight" />);
    const nav = screen.getByRole('navigation', { name: '작업 단계' });
    // 지난 단계는 번호 대신 체크 아이콘이라 글자는 이름뿐이다.
    expect(
      within(nav)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['TBM 보고서', '세팅', '3작업 전 확인', '4작업 종료']);
    expect(stateOf('TBM 보고서')).toBe('done');
    expect(stateOf('세팅')).toBe('done');
    expect(stateOf('작업 전 확인')).toBe('current');
    expect(stateOf('작업 종료')).toBe('todo');
    expect(itemOf('작업 전 확인')?.getAttribute('aria-current')).toBe('step');
    expect(itemOf('작업 종료')?.getAttribute('aria-current')).toBeNull();
  });

  it('처음 단계는 아무것도 끝나지 않고, 번호가 숫자로 보인다', () => {
    render(<WorkStageNav stage="report" />);
    expect(stateOf('TBM 보고서')).toBe('current');
    expect(itemOf('TBM 보고서')?.textContent).toBe('1TBM 보고서');
    expect(stateOf('세팅')).toBe('todo');
  });

  it('작업이 끝나면 지금 단계(작업 종료)도 ✓ 이고 굵게 지금 단계로 남는다', () => {
    render(<WorkStageNav stage="run" finished />);
    for (const label of ['TBM 보고서', '세팅', '작업 전 확인', '작업 종료']) {
      expect(stateOf(label)).toBe('done');
    }
    expect(itemOf('작업 종료')?.textContent).toBe('작업 종료');
    expect(itemOf('작업 종료')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('작업 종료').className).toContain('font-bold');
  });

  it('표시만 한다: 단추가 없고 눌러도 아무것도 바뀌지 않는다', () => {
    render(<WorkStageNav stage="setup" />);
    expect(screen.queryAllByRole('button')).toEqual([]);
    fireEvent.click(screen.getByText('작업 종료'));
    expect(stateOf('세팅')).toBe('current');
    expect(stateOf('작업 종료')).toBe('todo');
  });
});

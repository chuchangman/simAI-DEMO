import { workSignatureOf } from '@/__tests__/features/work/workFixture';
import { ReportView } from '@/features/work/report/ReportView';
import { blankReportForm } from '@/features/work/reportForm';
import { REPORT_CHECKS, WORK_TASKS, type ReportForm } from '@/features/work/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const T0 = new Date(2026, 10, 11, 9, 5).getTime();
const LEADER = { user_id: 1, name: '김안전', org: '(주)안전건설', title: '안전관리자' };
const PAPER_TITLE = 'TBM(작업 전 안전대화) 보고서';

/** 초안이 채워진 양식. */
function draftedForm(): ReportForm {
  return {
    info: {
      date_time_ms: T0,
      same_day: true,
      task_name: '철근 배근 외 1건',
      tasks: [{ code: 'REBAR' }, { text: '조적' }],
      place: '개구부 위험 구역',
      risk_assessed: true,
    },
    risks: [
      { risk: '개구부 추락', measure: '덮개·난간 설치' },
      { risk: '발판 위 전도', measure: '안전대 체결' },
      { risk: '', measure: '' },
    ],
    focus: { risk: '개구부 추락', measure: '덮개·난간 설치' },
    checks: REPORT_CHECKS.map(({ code, label }, i) => ({
      code,
      label,
      yes: i === 2 ? false : true,
      action: i === 2 ? '덮개 설치 전까지 접근 통제' : '',
    })),
    review: { daily: '작업 전 위험구역 3곳 확인', ending: '' },
  };
}

function paper(props: Partial<ComponentProps<typeof ReportView>> = {}) {
  return render(
    <ReportView
      form={blankReportForm(T0)}
      leader={LEADER}
      signatures={[]}
      catalog={WORK_TASKS}
      drafted={false}
      {...props}
    />,
  );
}

/** 머리 칸(th) 바로 옆 값 칸. */
const valueOf = (label: string): HTMLElement => {
  const cell = screen.getByText(label, { selector: 'th' }).nextElementSibling;
  if (!(cell instanceof HTMLElement)) throw new Error(`${label} 옆 칸이 없다`);
  return cell;
};
/** 줄무늬(시스템이 채울 칸) 인가. */
const isStriped = (cell: Element) => cell.className.includes('repeating-linear-gradient');

describe('종이 모양', () => {
  it('제목과 표 여섯 개가 프로토타입 순서로 놓인다', () => {
    const { container } = paper({ drafted: true, form: draftedForm() });
    expect(screen.getByText(PAPER_TITLE)).toBeTruthy();
    const tables = [...container.querySelectorAll('table')];
    expect(tables).toHaveLength(6);
    expect(tables.map((t) => t.querySelector('th')?.textContent)).toEqual([
      '일시',
      '',
      '중점위험',
      '안전조치 확인',
      '일일 안전점검',
      '번호',
    ]);
    // 표 머리 글
    for (const label of [
      '작업일 동일 여부',
      '작업명',
      '장소',
      '작업내용',
      '위험성평가 여부',
      '잠재위험',
      '대책',
      '중점대책',
      '리더 소속',
      '직책',
      '성명',
      '예',
      '아니오',
      '조치 내용',
      '종료 미팅',
      '참석자',
      '서명',
    ]) {
      expect(screen.getAllByText(label, { selector: 'th' }).length).toBeGreaterThan(0);
    }
  });

  it('고칠 수 있는 종이에서 TBM 을 쓰기 전(작업내용 없음)에는 일시를 비워 둔다 — 서버가 넣은 값은 작업이 생긴 시각이다(-734)', () => {
    paper({ editable: true });
    expect(valueOf('일시').textContent).toBe('');
    cleanup();
    // 읽기 전용 종이(지난 날)는 받은 값 그대로
    paper();
    expect(valueOf('일시').textContent).toBe('2026-11-11 09:05');
  });

  it('일시는 YYYY-MM-DD HH:mm 으로, 작업내용은 • 줄로 보인다(코드는 서버 문구로)', () => {
    paper({ drafted: true, form: draftedForm() });
    expect(valueOf('일시').textContent).toBe('2026-11-11 09:05');
    expect(
      within(valueOf('작업내용'))
        .getAllByText(/^• /)
        .map((p) => p.textContent),
    ).toEqual(['• 철근 배근', '• 조적']);
  });

  it('안전조치 확인은 서버 고정 문구 5줄이고, 조치 내용은 아니오인 줄에만 보인다', () => {
    paper({ drafted: true, form: draftedForm() });
    for (const { label } of REPORT_CHECKS) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('덮개 설치 전까지 접근 통제')).toHaveLength(1);

    const form = draftedForm();
    form.checks[2] = { ...form.checks[2]!, yes: true };
    cleanup();
    paper({ drafted: true, form });
    expect(screen.queryByText('덮개 설치 전까지 접근 통제')).toBeNull();
  });

  it('예·아니오는 고른 쪽 네모가 칠해진다(아직 안 골랐으면 둘 다 빈 칸)', () => {
    paper({ drafted: true, form: draftedForm() });
    const checked = (cell: HTMLElement) =>
      [...cell.querySelectorAll('[data-checked]')].map((box) => box.getAttribute('data-checked'));
    expect(checked(valueOf('작업일 동일 여부'))).toEqual(['true', 'false']);
    expect(checked(valueOf('위험성평가 여부'))).toEqual(['true', 'false']);
    cleanup();

    const form = draftedForm();
    form.info.risk_assessed = false;
    paper({ drafted: true, form });
    expect(checked(valueOf('위험성평가 여부'))).toEqual(['false', 'true']);
    cleanup();

    const blank = blankReportForm(T0);
    blank.info.same_day = null;
    paper({ form: blank });
    expect(checked(valueOf('작업일 동일 여부'))).toEqual(['false', 'false']);
  });
});

describe('초안 전 줄무늬', () => {
  it('시스템이 채울 칸은 줄무늬이고 일시·작업내용·점검 줄 이름은 아니다', () => {
    const { container } = paper();
    for (const label of ['작업명', '장소', '위험성평가 여부', '중점위험', '중점대책']) {
      expect(isStriped(valueOf(label)), label).toBe(true);
    }
    for (const label of ['리더 소속', '직책', '성명']) {
      expect(isStriped(valueOf(label)), label).toBe(true);
    }
    expect(isStriped(valueOf('일일 안전점검'))).toBe(true);
    expect(isStriped(valueOf('종료 미팅'))).toBe(true);
    expect(isStriped(valueOf('일시'))).toBe(false);
    expect(isStriped(valueOf('작업일 동일 여부'))).toBe(false);
    expect(isStriped(valueOf('작업내용'))).toBe(false);
    // 위험 3줄, 점검 5줄의 예·아니오·조치 칸
    const tables = [...container.querySelectorAll('table')];
    const riskRows = tables[1]!.querySelectorAll('tbody tr');
    expect(riskRows).toHaveLength(3);
    for (const row of riskRows) {
      expect([...row.querySelectorAll('td')].every(isStriped)).toBe(true);
    }
    const checkRows = tables[3]!.querySelectorAll('tbody tr');
    expect(checkRows).toHaveLength(5);
    for (const row of checkRows) {
      const [name, ...rest] = [...row.querySelectorAll('td')];
      expect(isStriped(name!)).toBe(false);
      expect(rest.every(isStriped)).toBe(true);
    }
  });

  it('리더는 초안이 끝나기 전에는 보이지 않는다', () => {
    paper({ form: blankReportForm(T0), drafted: false });
    expect(screen.queryByText('김안전')).toBeNull();
    expect(screen.queryByText('(주)안전건설')).toBeNull();
  });

  it('참석자 표는 줄무늬가 아니다', () => {
    const { container } = paper();
    const attendees = [...container.querySelectorAll('table')][5]!;
    expect(attendees.className.includes('repeating-linear-gradient')).toBe(false);
    expect([...attendees.querySelectorAll('td')].some(isStriped)).toBe(false);
  });
});

describe('초안 후', () => {
  it('줄무늬가 없고 값과 리더(소속·직책·성명)가 보인다', () => {
    const { container } = paper({ drafted: true, form: draftedForm() });
    expect(container.innerHTML.includes('repeating-linear-gradient')).toBe(false);
    expect(valueOf('작업명').textContent).toBe('철근 배근 외 1건');
    expect(valueOf('장소').textContent).toBe('개구부 위험 구역');
    expect(valueOf('중점위험').textContent).toBe('개구부 추락');
    expect(valueOf('중점대책').textContent).toBe('덮개·난간 설치');
    expect(valueOf('리더 소속').textContent).toBe('(주)안전건설');
    expect(valueOf('직책').textContent).toBe('안전관리자');
    expect(valueOf('성명').textContent).toBe('김안전');
    expect(valueOf('일일 안전점검').textContent).toBe('작업 전 위험구역 3곳 확인');
    expect(screen.getByText('①')).toBeTruthy();
    expect(screen.getByText('②')).toBeTruthy();
    expect(screen.getByText('③')).toBeTruthy();
  });

  it('리더가 없으면(계정 정보 없음) 리더 칸은 빈 칸이다', () => {
    paper({ drafted: true, form: draftedForm(), leader: null });
    expect(valueOf('성명').textContent).toBe('');
  });
});

describe('작업내용 선택 칸', () => {
  it('고칠 수 있는 종이에 작업내용이 비었으면 점선 + 작업내용 선택 이 보인다', () => {
    paper({ editable: true });
    expect(screen.getByText('+ 작업내용 선택')).toBeTruthy();
  });

  it('고칠 수 없는 종이(출력 포함)에는 나오지 않는다', () => {
    paper({ editable: false });
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
    cleanup();
    paper({ editable: false, variant: 'print' });
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
  });

  it('작업내용이 있으면 고칠 수 있어도 나오지 않는다', () => {
    paper({ editable: true, drafted: true, form: draftedForm() });
    expect(screen.queryByText('+ 작업내용 선택')).toBeNull();
  });
});

describe('참석자 서명', () => {
  it('서명이 없어도 네 줄을 비워 두고 번호를 붙인다', () => {
    const { container } = paper();
    const rows = [...container.querySelectorAll('table')][5]!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(4);
    expect([...rows].map((row) => row.querySelector('td')?.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('서명 목록의 이름과 이미지가 줄마다 들어가고, 네 명을 넘으면 줄이 늘어난다', () => {
    const signatures = ['박반장', '김안전', '이현장', '정작업', '최신입'].map((name, i) =>
      workSignatureOf({
        signature_id: String(i),
        signer_name: name,
        image_url: `https://img.test/${i}.png`,
      }),
    );
    const { container } = paper({ signatures });
    const rows = [...container.querySelectorAll('table')][5]!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(5);
    expect(within(rows[0] as HTMLElement).getByText('박반장')).toBeTruthy();
    expect(screen.getByAltText('박반장 서명').getAttribute('src')).toBe('https://img.test/0.png');
    expect(screen.getByAltText('최신입 서명')).toBeTruthy();
  });
});

describe('누르면 편집', () => {
  it('고칠 수 있는 종이는 눌러서도 Enter 로도 편집을 요청한다', () => {
    const onEdit = vi.fn();
    paper({ editable: true, onEdit });
    const target = screen.getByRole('button', { name: 'TBM 보고서 편집' });
    fireEvent.click(target);
    expect(onEdit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(target, { key: 'a' });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('고칠 수 없는 종이는 단추가 아니고 눌러도 아무 일이 없다', () => {
    const onEdit = vi.fn();
    paper({ editable: false, onEdit });
    expect(screen.queryByRole('button', { name: 'TBM 보고서 편집' })).toBeNull();
    fireEvent.click(screen.getByText(PAPER_TITLE));
    expect(onEdit).not.toHaveBeenCalled();
  });
});

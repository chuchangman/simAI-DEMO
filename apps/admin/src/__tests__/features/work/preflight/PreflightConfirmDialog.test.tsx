import { NO_CHECKS, type PreflightChecks } from '@/features/work/preflight/preflight';
import { PreflightConfirmDialog } from '@/features/work/preflight/PreflightConfirmDialog';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

/** 체크 상태를 들고 있는 상위 화면 대역. */
function Harness({
  signerCount = 0,
  pending = false,
  error = null,
  draftWarning = null,
  warnings,
  setupCompleted = true,
  onGoSetup,
  initial = NO_CHECKS,
  onSign = vi.fn(),
  onStart = vi.fn(),
  onCancel = vi.fn(),
}: {
  signerCount?: number;
  pending?: boolean;
  error?: string | null;
  draftWarning?: string | null;
  warnings?: readonly string[];
  setupCompleted?: boolean;
  onGoSetup?: () => void;
  initial?: PreflightChecks;
  onSign?: () => void;
  onStart?: () => void;
  onCancel?: () => void;
}) {
  const [checks, setChecks] = useState(initial);
  return (
    <PreflightConfirmDialog
      checks={checks}
      onChecksChange={setChecks}
      signerCount={signerCount}
      pending={pending}
      error={error}
      draftWarning={draftWarning}
      warnings={warnings}
      setupCompleted={setupCompleted}
      onGoSetup={onGoSetup}
      onSign={onSign}
      onStart={onStart}
      onCancel={onCancel}
    />
  );
}

const start = () => screen.getByRole('button', { name: '작업 시작' }) as HTMLButtonElement;
const checkReport = () => screen.getByRole('checkbox', { name: 'TBM 보고서를 확인했습니다' });
const checkLayout = () => screen.getByRole('checkbox', { name: '가상 레이아웃을 확인했습니다' });

describe('PreflightConfirmDialog', () => {
  it('제목·체크 둘·서명 줄과 취소·작업 시작을 보인다', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: '작업 전 확인' })).toBeTruthy();
    expect((checkReport() as HTMLInputElement).checked).toBe(false);
    expect((checkLayout() as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('참석자 서명이 필요합니다')).toBeTruthy();
    expect(screen.getByRole('button', { name: '취소' })).toBeTruthy();
    expect(start().disabled).toBe(true);
  });

  it('체크 둘과 서명 1명이 모두 충족돼야 작업 시작이 켜진다', () => {
    render(<Harness signerCount={1} />);
    expect(start().disabled).toBe(true);
    fireEvent.click(checkReport());
    expect(start().disabled).toBe(true);
    expect(screen.getByText('위 확인 칸 두 개를 체크하면 「작업 시작」이 켜집니다')).toBeTruthy();
    fireEvent.click(checkLayout());
    expect(start().disabled).toBe(false);
    expect(screen.queryByText('위 확인 칸 두 개를 체크하면 「작업 시작」이 켜집니다')).toBeNull();

    // 체크를 하나 풀면 다시 꺼진다.
    fireEvent.click(checkReport());
    expect(start().disabled).toBe(true);
  });

  it('세팅 완료 전이면 체크·서명을 다 해도 작업 시작이 꺼지고 안내와 세팅으로 단추를 보인다(-642)', () => {
    const onGoSetup = vi.fn();
    render(
      <Harness
        signerCount={1}
        setupCompleted={false}
        onGoSetup={onGoSetup}
        initial={{ reportChecked: true, layoutChecked: true }}
      />,
    );
    expect(start().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('세팅을 완료해야 시작할 수 있습니다');
    fireEvent.click(screen.getByRole('button', { name: '세팅으로' }));
    expect(onGoSetup).toHaveBeenCalledTimes(1);
  });

  it('세팅을 완료했으면 세팅으로 단추가 없다', () => {
    render(<Harness signerCount={1} onGoSetup={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '세팅으로' })).toBeNull();
  });

  it('체크를 다 해도 서명이 없으면 작업 시작은 꺼져 있다', () => {
    render(<Harness signerCount={0} initial={{ reportChecked: true, layoutChecked: true }} />);
    expect(start().disabled).toBe(true);
  });

  it('서명이 있으면 체크 모양과 서명 인원을 보이고 서명하기는 없다', () => {
    render(<Harness signerCount={3} />);
    expect(screen.getByText('참석자 서명 3명')).toBeTruthy();
    expect(screen.queryByText('참석자 서명이 필요합니다')).toBeNull();
    expect(screen.queryByRole('button', { name: '서명하기' })).toBeNull();
  });

  it('서명하기를 누르면 서명 창을 열라고 알린다', () => {
    const onSign = vi.fn();
    render(<Harness onSign={onSign} />);
    fireEvent.click(screen.getByRole('button', { name: '서명하기' }));
    expect(onSign).toHaveBeenCalledTimes(1);
  });

  it('작업 시작·취소를 누르면 각각 알린다', () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    render(
      <Harness
        signerCount={1}
        initial={{ reportChecked: true, layoutChecked: true }}
        onStart={onStart}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(start());
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('시작 요청 중에는 모두 충족해도 작업 시작을 막는다', () => {
    render(
      <Harness signerCount={1} pending initial={{ reportChecked: true, layoutChecked: true }} />,
    );
    expect(start().disabled).toBe(true);
  });

  it('AI 초안 경고가 있으면 보이되 작업 시작은 막지 않는다(-625)', () => {
    const onStart = vi.fn();
    const warning = 'AI 초안을 만들지 않았습니다. 위험·대책·점검 칸이 비어 있을 수 있습니다.';
    render(
      <Harness
        signerCount={1}
        draftWarning={warning}
        initial={{ reportChecked: true, layoutChecked: true }}
        onStart={onStart}
      />,
    );
    expect(screen.getByText(warning)).toBeTruthy();
    expect(start().disabled).toBe(false);
    fireEvent.click(start());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('AI 초안 경고가 없으면 경고 줄도 없다', () => {
    render(<Harness signerCount={1} />);
    expect(screen.queryByText(/AI 초안을/)).toBeNull();
  });

  it('시작이 거절됐으면 창 안에 이유를 보인다', () => {
    render(<Harness signerCount={1} error="오늘 작업만 시작할 수 있어요" />);
    expect(screen.getByRole('alert').textContent).toBe('오늘 작업만 시작할 수 있어요');
  });

  it('서명은 체크 칸이 아니라 ✓/✗ 상태로 보인다(사람이 누르는 칸은 확인 둘뿐, -730)', () => {
    const { rerender } = render(<Harness signerCount={0} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByTestId('signer-state').className).toContain('text-destructive');
    rerender(<Harness signerCount={2} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByTestId('signer-state').className).toContain('text-ok');
    expect(screen.getByText('참석자 서명 2명')).toBeTruthy();
  });

  it('시작 전 경고(보호구 미수신·워치 0대)는 한 줄씩 보이되 작업 시작은 막지 않는다(-730)', () => {
    const onStart = vi.fn();
    const warnings = ['보호구 상태가 들어오지 않아', '연결된 워치가 없습니다'];
    render(
      <Harness
        signerCount={1}
        warnings={warnings}
        initial={{ reportChecked: true, layoutChecked: true }}
        onStart={onStart}
      />,
    );
    const list = screen.getByRole('list', { name: '시작 전 경고' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(start().disabled).toBe(false);
    fireEvent.click(start());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('경고가 없으면 경고 목록도 없다', () => {
    render(<Harness signerCount={1} />);
    expect(screen.queryByRole('list', { name: '시작 전 경고' })).toBeNull();
  });
});

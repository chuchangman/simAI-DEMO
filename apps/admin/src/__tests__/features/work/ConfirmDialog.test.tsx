import { ConfirmDialog } from '@/features/work/ConfirmDialog';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('제목·설명과 확인·취소 단추를 보이고 각각 알린다', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="보고서를 보낼까요?"
        description="보낸 뒤에는 고칠 수 없습니다."
        confirmLabel="보내기"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('dialog', { name: '보고서를 보낼까요?' })).toBeTruthy();
    expect(screen.getByText('보낸 뒤에는 고칠 수 없습니다.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('확인 조건이 안 맞거나 요청 중이면 확인 단추를 막고, 가운데에 넣은 내용을 보인다', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="작업 전 확인"
        confirmLabel="작업 시작"
        confirmDisabled
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      >
        <p>체크 줄</p>
      </ConfirmDialog>,
    );
    expect(screen.getByText('체크 줄')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: '작업 시작' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ConfirmDialog
        title="작업 전 확인"
        confirmLabel="작업 시작"
        pending
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: '작업 시작' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

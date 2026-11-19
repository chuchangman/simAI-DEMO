import { workSignatureOf } from '@/__tests__/features/work/workFixture';
import { SignatureUploadError, WORK_ERROR } from '@/features/work/api';
import { SignDialog } from '@/features/work/preflight/SignDialog';
import type { SignersState } from '@/features/work/preflight/useSigners';
import { SIGNATURE_MAX_COUNT, SIGNER_NAME_MAX, type WorkSignature } from '@/features/work/types';
import { ApiError } from '@/lib/http';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 시험마다 새로 만드는 2D 맥락 대역. */
const makeContext = () => ({
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
});
let context = makeContext();

beforeEach(() => {
  context = makeContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 서명 묶음 대역. 목록·요청 결과·실패를 시험이 정한다. */
function signersOf(overrides: Partial<SignersState> & { items?: WorkSignature[] } = {}) {
  const { items = [], ...rest } = overrides;
  const state: SignersState = {
    ready: true,
    signers: items,
    count: items.length,
    adding: false,
    removing: false,
    addError: null,
    removeError: null,
    add: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    resetErrors: vi.fn(),
    ...rest,
  };
  return state;
}

const addButton = () => screen.getByRole('button', { name: '서명 추가' }) as HTMLButtonElement;
const nameInput = () => screen.getByLabelText('서명자 이름') as HTMLInputElement;
const type = (name: string) => fireEvent.change(nameInput(), { target: { value: name } });
const draw = () =>
  fireEvent.pointerDown(screen.getByLabelText('서명 패드'), {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });

describe('SignDialog', () => {
  it('이름 입력·서명 패드와 지우기·서명 추가·완료를 보이고, 이름 글자 수는 서버 한도로 막는다', () => {
    render(<SignDialog signers={signersOf()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '참석자 서명' })).toBeTruthy();
    expect(nameInput().maxLength).toBe(SIGNER_NAME_MAX);
    expect(screen.getByLabelText('서명 패드')).toBeTruthy();
    for (const name of ['지우기', '서명 추가', '완료']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText('서명자 0명')).toBeTruthy();
  });

  it('이름과 획이 모두 있어야 서명 추가가 켜지고, 지우기로 획을 지우면 다시 꺼진다', () => {
    render(<SignDialog signers={signersOf()} onClose={vi.fn()} />);
    expect(addButton().disabled).toBe(true);

    type('홍길동');
    expect(addButton().disabled).toBe(true);

    draw();
    expect(addButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(addButton().disabled).toBe(true);

    draw();
    type('   ');
    expect(addButton().disabled).toBe(true);
  });

  it('서명 추가를 누르면 이름(앞뒤 공백 제외)과 PNG 로 추가를 부르고, 이름과 패드를 비운다', async () => {
    const signers = signersOf();
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    type(' 홍길동 ');
    draw();
    fireEvent.click(addButton());

    await waitFor(() => expect(signers.add).toHaveBeenCalledTimes(1));
    const [name, image] = vi.mocked(signers.add).mock.calls[0]!;
    expect(name).toBe('홍길동');
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe('image/png');

    await waitFor(() => expect(nameInput().value).toBe(''));
    expect(addButton().disabled).toBe(true);
    expect(context.clearRect).toHaveBeenCalled();
  });

  it('추가가 실패하면 이름과 서명을 그대로 두어 다시 시도할 수 있다', async () => {
    const signers = signersOf({ add: vi.fn(async () => false) });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    fireEvent.click(addButton());
    await waitFor(() => expect(signers.add).toHaveBeenCalledTimes(1));
    expect(nameInput().value).toBe('홍길동');
    await waitFor(() => expect(addButton().disabled).toBe(false));
  });

  it('이름 칸에서 Enter 를 눌러도 추가하지만, 한글 조합 중에는 추가하지 않는다', async () => {
    const signers = signersOf();
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    fireEvent.keyDown(nameInput(), { key: 'Enter', isComposing: true });
    await Promise.resolve();
    expect(signers.add).not.toHaveBeenCalled();

    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    await waitFor(() => expect(signers.add).toHaveBeenCalledTimes(1));
  });

  it('Enter 를 연달아 눌러도 한 번만 추가한다', async () => {
    const signers = signersOf();
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    fireEvent.keyDown(nameInput(), { key: 'Enter' });
    await waitFor(() => expect(signers.add).toHaveBeenCalled());
    expect(signers.add).toHaveBeenCalledTimes(1);
  });

  it('서명자 N명과 각 줄(이름·썸네일·삭제)을 보이고, 삭제는 그 서명을 지운다', () => {
    const signers = signersOf({
      items: [
        workSignatureOf({ signature_id: '11', signer_name: '박반장' }),
        workSignatureOf({ signature_id: '12', signer_name: '이십장' }),
      ],
    });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    expect(screen.getByText('서명자 2명')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: '서명자 목록' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('박반장')).toBeTruthy();
    expect(within(rows[0]!).getByAltText('박반장 서명')).toBeTruthy();

    fireEvent.click(within(rows[1]!).getByRole('button', { name: '이십장 서명 삭제' }));
    expect(signers.remove).toHaveBeenCalledWith('12');
  });

  it('삭제가 막히면(작업 시작 뒤) 이유를 보인다', () => {
    const signers = signersOf({
      items: [workSignatureOf({ signer_name: '박반장' })],
      removeError: new ApiError(409, { code: WORK_ERROR.INVALID_STATE }),
    });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('작업을 시작해서 서명을 지울 수 없어요');
  });

  it('서버가 인원 상한으로 거절하면 상한 안내를 보인다', () => {
    const signers = signersOf({
      addError: new ApiError(409, { code: WORK_ERROR.SIGNATURE_LIMIT_REACHED }),
    });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain(`${SIGNATURE_MAX_COUNT}명`);
  });

  it('이미 50명이면 안내를 보이고 서명 추가가 꺼진다', () => {
    const items = Array.from({ length: SIGNATURE_MAX_COUNT }, (_, i) =>
      workSignatureOf({ signature_id: String(i + 1), signer_name: `서명자${i + 1}` }),
    );
    render(<SignDialog signers={signersOf({ items })} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    expect(addButton().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain(`${SIGNATURE_MAX_COUNT}명`);
  });

  it('서명 이미지를 올리지 못했으면 그 이유를 보인다', () => {
    const signers = signersOf({ addError: new SignatureUploadError('UPLOAD_FAILED') });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('서명을 올리지 못했어요');
  });

  it('서명할 보고서가 아직 없으면 이름과 획이 있어도 추가할 수 없다', () => {
    render(<SignDialog signers={signersOf({ ready: false })} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    expect(addButton().disabled).toBe(true);
  });

  it('요청 중이면 서명 추가와 삭제가 꺼진다', () => {
    const signers = signersOf({
      adding: true,
      items: [workSignatureOf({ signer_name: '박반장' })],
    });
    render(<SignDialog signers={signers} onClose={vi.fn()} />);
    type('홍길동');
    draw();
    expect(addButton().disabled).toBe(true);

    cleanup();
    render(
      <SignDialog
        signers={signersOf({ removing: true, items: [workSignatureOf({ signer_name: '박반장' })] })}
        onClose={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole('button', { name: '박반장 서명 삭제' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('열 때 지난 실패 안내를 지우고, 완료를 누르면 닫는다', () => {
    const signers = signersOf();
    const onClose = vi.fn();
    render(<SignDialog signers={signers} onClose={onClose} />);
    expect(signers.resetErrors).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

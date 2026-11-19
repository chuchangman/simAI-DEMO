import { SignPad, type SignPadHandle } from '@/features/work/preflight/SignPad';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
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

const pad = () => screen.getByLabelText('서명 패드');
const press = (x = 10, y = 10) =>
  fireEvent.pointerDown(pad(), { clientX: x, clientY: y, pointerId: 1 });

describe('SignPad', () => {
  it('처음에는 획이 없고, 첫 획에서 한 번만 획이 생겼다고 알린다', () => {
    const onInkChange = vi.fn();
    render(<SignPad onInkChange={onInkChange} />);
    expect(onInkChange).not.toHaveBeenCalled();

    press();
    expect(onInkChange).toHaveBeenCalledTimes(1);
    expect(onInkChange).toHaveBeenLastCalledWith(true);
    // 점을 찍었다.
    expect(context.arc).toHaveBeenCalledTimes(1);
    expect(context.fill).toHaveBeenCalledTimes(1);

    // 같은 서명 안에서 다시 눌러도 다시 알리지 않는다.
    press(20, 20);
    expect(onInkChange).toHaveBeenCalledTimes(1);
  });

  it('누른 채 움직이면 선을 긋고, 떼면 더는 긋지 않는다', () => {
    render(<SignPad onInkChange={vi.fn()} />);
    fireEvent.pointerMove(pad(), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(context.stroke).not.toHaveBeenCalled();

    press();
    fireEvent.pointerMove(pad(), { clientX: 30, clientY: 12, pointerId: 1 });
    expect(context.moveTo).toHaveBeenCalledTimes(1);
    expect(context.lineTo).toHaveBeenCalledTimes(1);
    expect(context.stroke).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(pad(), { pointerId: 1 });
    fireEvent.pointerMove(pad(), { clientX: 50, clientY: 20, pointerId: 1 });
    expect(context.stroke).toHaveBeenCalledTimes(1);
  });

  it('지우면 그림을 비우고 획이 없다고 알리며, 다시 그리면 또 알린다', () => {
    const onInkChange = vi.fn();
    const ref = createRef<SignPadHandle>();
    render(<SignPad ref={ref} onInkChange={onInkChange} />);
    press();
    expect(onInkChange).toHaveBeenLastCalledWith(true);

    act(() => ref.current?.clear());
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(onInkChange).toHaveBeenLastCalledWith(false);

    press();
    expect(onInkChange).toHaveBeenCalledTimes(3);
    expect(onInkChange).toHaveBeenLastCalledWith(true);
  });

  it('그림을 PNG 로 꺼낸다', async () => {
    const ref = createRef<SignPadHandle>();
    render(<SignPad ref={ref} onInkChange={vi.fn()} />);
    press();
    const blob = await ref.current?.toBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    );
  });

  it('그릴 수 없는 환경(2D 맥락 없음)에서도 깨지지 않는다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onInkChange = vi.fn();
    render(<SignPad onInkChange={onInkChange} />);
    expect(() => {
      press();
      fireEvent.pointerMove(pad(), { clientX: 30, clientY: 12, pointerId: 1 });
    }).not.toThrow();
  });
});

import { useFitScale } from '@/features/work/report/useFitScale';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 은 배치를 하지 않아 크기가 모두 0 이다. 요소의 data-size("가로x세로")를 크기로 돌려주게 해서 배율 계산을 본다.

const sizeOf = (el: Element): [number, number] => {
  const [w = 0, h = 0] = ((el as HTMLElement).dataset.size ?? '0x0').split('x').map(Number);
  return [w, h];
};

let notify: () => void = () => undefined;

class FakeResizeObserver {
  constructor(callback: () => void) {
    notify = callback;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return sizeOf(this)[0];
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return sizeOf(this)[1];
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return sizeOf(this)[0];
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return sizeOf(this)[1];
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ frame, content }: { frame: string; content: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(frameRef, contentRef);
  return (
    <div ref={frameRef} data-size={frame}>
      <div ref={contentRef} data-size={content} data-testid="content" data-scale={scale} />
    </div>
  );
}

const scaleNow = () => Number(screen.getByTestId('content').dataset.scale);

describe('useFitScale', () => {
  it('틀에 통째로 들어가게, 더 빡빡한 쪽(가로·세로) 비율로 줄인다', () => {
    render(<Harness frame="536x302" content="794x1350" />);
    expect(scaleNow()).toBeCloseTo(302 / 1350, 5);

    cleanup();
    render(<Harness frame="300x900" content="794x1123" />);
    expect(scaleNow()).toBeCloseTo(300 / 794, 5);
  });

  it('틀보다 작은 내용은 키우지 않는다', () => {
    render(<Harness frame="800x600" content="400x200" />);
    expect(scaleNow()).toBe(1);
  });

  it('크기를 잴 수 없으면(0) 1 로 둔다', () => {
    render(<Harness frame="0x0" content="794x1123" />);
    expect(scaleNow()).toBe(1);
  });

  it('틀이나 내용의 크기가 바뀌었다는 알림을 받으면 다시 잰다', () => {
    const { rerender } = render(<Harness frame="536x302" content="794x1123" />);
    expect(scaleNow()).toBeCloseTo(302 / 1123, 5);

    // 같은 요소의 크기만 바뀐 것처럼 data-size 를 바꾸고 관찰 알림을 보낸다.
    rerender(<Harness frame="536x1200" content="794x1123" />);
    act(() => notify());
    expect(scaleNow()).toBeCloseTo(536 / 794, 5);
  });
});

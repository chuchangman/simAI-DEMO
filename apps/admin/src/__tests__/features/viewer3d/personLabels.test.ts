import {
  drawLabelCellsOnCanvas,
  WATCH_CELL_COLORS,
  WATCH_DISCONNECTED_DOT_COLOR,
} from '@/features/viewer3d/LabelSprite';
import { createViewerStore } from '@/features/viewer3d/viewer3d.store';
import { describe, expect, it, vi } from 'vitest';

function createMockCanvas() {
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  const arcs: { r: number; fill?: string; stroke?: string }[] = [];
  let lastArcRadius: number | null = null;

  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'middle',
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(() => {
      lastArcRadius = null;
    }),
    roundRect: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn((_x: number, _y: number, r: number) => {
      lastArcRadius = r;
    }),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(() => {
      fills.push(String(ctx.fillStyle));
      if (lastArcRadius !== null) {
        arcs.push({ r: lastArcRadius, fill: String(ctx.fillStyle) });
      }
    }),
    stroke: vi.fn(() => {
      strokes.push(String(ctx.strokeStyle));
      if (lastArcRadius !== null) {
        arcs.push({ r: lastArcRadius, stroke: String(ctx.strokeStyle) });
      }
    }),
    fillText: vi.fn((text: string) => {
      texts.push(text);
    }),
    measureText: vi.fn((text: string) => ({ width: [...text].length * 24 })),
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx, fills, strokes, texts, arcs };
}

describe('뷰어 personLabels 스토어 동치 비교(-658)', () => {
  it('전체 칸 목록이 같으면 Store 참조를 유지하고, 한 사람만 바뀌면 나머지 사람 배열 참조는 유지한다', () => {
    const store = createViewerStore('LIVE');
    expect(store.getState().personLabels).toBeNull();

    store.getState().setPersonLabels({
      'w-1': [
        { kind: 'watch', status: 'connected' },
        { kind: 'text', text: '김철수' },
      ],
      'w-2': [{ kind: 'text', text: '미확인 1' }],
    });
    const first = store.getState().personLabels!;
    const w2First = first['w-2'];

    store.getState().setPersonLabels({
      'w-1': [
        { kind: 'watch', status: 'connected' },
        { kind: 'text', text: '김철수' },
      ],
      'w-2': [{ kind: 'text', text: '미확인 1' }],
    });
    expect(store.getState().personLabels).toBe(first);

    // w-1 이름만 바꾸면 w-2 의 칸 배열 참조는 그대로 재사용한다
    store.getState().setPersonLabels({
      'w-1': [
        { kind: 'watch', status: 'connected' },
        { kind: 'text', text: '박민수' },
      ],
      'w-2': [{ kind: 'text', text: '미확인 1' }],
    });
    expect(store.getState().personLabels).not.toBe(first);
    expect(store.getState().personLabels?.['w-2']).toBe(w2First);

    store.getState().setPersonLabels(undefined);
    expect(store.getState().personLabels).toBeNull();
  });
});

describe('3D 이름표 캔버스 렌더링 drawLabelCellsOnCanvas(-658 A안)', () => {
  it('연결된 워치는 하늘색 칸 배경과 하늘색 스마트워치 선 아이콘을 그리고 빨간 점은 찍지 않는다', () => {
    const { canvas, fills, strokes, texts } = createMockCanvas();
    drawLabelCellsOnCanvas(
      canvas,
      [
        { kind: 'watch', status: 'connected' },
        { kind: 'text', text: '김철수' },
      ],
      { ink: '#eef1f8', background: 'rgba(10, 27, 51, 0.8)', theme: 'dark' },
    );

    expect(fills).toContain(WATCH_CELL_COLORS.dark.connectedBg);
    expect(strokes).toContain(WATCH_CELL_COLORS.dark.connectedStroke);
    expect(fills).not.toContain(WATCH_DISCONNECTED_DOT_COLOR);
    expect(texts).toEqual(['김철수']);
  });

  it('끊긴 워치는 회색 스마트워치 아이콘과 작은 빨간 점을 그리고 이름은 그대로 둔다', () => {
    const { canvas, fills, strokes, texts } = createMockCanvas();
    drawLabelCellsOnCanvas(
      canvas,
      [
        { kind: 'watch', status: 'disconnected' },
        { kind: 'text', text: '이영희' },
      ],
      { ink: '#eef1f8', background: 'rgba(10, 27, 51, 0.8)', theme: 'dark' },
    );

    expect(fills).not.toContain(WATCH_CELL_COLORS.dark.connectedBg);
    expect(strokes).toContain(WATCH_CELL_COLORS.dark.disconnectedStroke);
    expect(fills).toContain(WATCH_DISCONNECTED_DOT_COLOR);
    expect(texts).toEqual(['이영희']);
  });

  it('워치 없는 사람은 아이콘 칸 없이 이름 칸과 뒤따르는 PPE 칸만 위험 글자 색으로 그린다', () => {
    const { canvas, ctx, strokes, texts } = createMockCanvas();
    drawLabelCellsOnCanvas(
      canvas,
      [
        { kind: 'text', text: '미확인 1' },
        { kind: 'text', text: '안전모 미착용' },
      ],
      { ink: '#ff6b74', background: 'rgba(10, 27, 51, 0.8)', theme: 'dark' },
    );

    expect(strokes).toHaveLength(0);
    expect(texts).toEqual(['미확인 1', '안전모 미착용']);
    expect(ctx.fillStyle).toBe('#ff6b74');
  });
});

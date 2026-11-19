import { ToolPalette } from '@/features/layout/spatialHost/ToolPalette';
import { useSetupFlowStore } from '@/features/setup/setup.store';
import { TBM_WORKS_KEY } from '@/features/tbm/api';
import { todayIsoDate } from '@/features/tbm/taskInput';
import type { TbmWorkUnit } from '@/features/tbm/types';
import { useSessionStore, type Role } from '@/store/session.store';
import { startZoneEdit, stopZoneEdit } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 맵 재생성 도구의 서버 연결은 이 시험의 관심 밖이다(자체 시험이 있다).
vi.mock('@/features/layout/useSceneRegenerate', () => ({
  useSceneRegenerate: () => ({
    current: null,
    isInProgress: false,
    isSubmitting: false,
    isActivating: false,
    activatedSceneVersion: null,
    requestError: null,
    regenerate: vi.fn(),
    activateCandidate: vi.fn(),
  }),
}));

const onResetView = vi.fn();
const onRetry3d = vi.fn();

/** 오늘 작업 하나(대기 화면 판정용). 진행 값은 서버가 작업마다 싣는 값이다. */
const todayWork = (
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE',
  progress: NonNullable<TbmWorkUnit['progress']>,
): TbmWorkUnit => ({
  work_id: '1',
  status,
  progress,
  date: todayIsoDate(),
  name: '작업',
  from_ms: 0,
  to_ms: 1,
  zone_id: null,
  place: null,
  planned_people: 1,
  lead: null,
  layout_id: null,
  work_type: null,
});

/** works 를 주면 관제가 받아 둔 작업 목록이다(없으면 아직 모른다). */
function renderPalette(
  props: Partial<React.ComponentProps<typeof ToolPalette>> = {},
  role: Role = 'ADMIN',
  works?: TbmWorkUnit[],
) {
  useSessionStore.setState({ session: { accessToken: 't', user: { id: role, role } } });
  const client = new QueryClient();
  if (works) client.setQueryData(TBM_WORKS_KEY, works);
  return render(
    <ToolPalette
      view="3d"
      onResetView={onResetView}
      onRetry3d={onRetry3d}
      currentSceneVersion={null}
      {...props}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

const button = (name: string) => screen.queryByRole('button', { name });

beforeEach(() => {
  onResetView.mockReset();
  onRetry3d.mockReset();
});
afterEach(() => {
  cleanup();
  stopZoneEdit();
  useSetupFlowStore.setState({ zonesCommitted: false });
  useSessionStore.setState({ session: undefined });
});

describe('ToolPalette 틀', () => {
  it('아이콘 줄 하나가 위쪽 왼쪽 자리에 고정돼 있다', () => {
    renderPalette();
    const bar = screen.getByRole('group', { name: '도구' });
    expect(bar.className).toContain('top-[72px]');
    expect(bar.className).toContain('left-3.5');
    expect(bar.getAttribute('style')).toBeNull();
  });

  it('도구 손잡이와 관리자 편집 버튼은 없다', () => {
    renderPalette();
    act(() => startZoneEdit());
    for (const name of ['도구 접기', '도구 펼치기', '관리자 편집 모드']) {
      expect(button(name)).toBeNull();
    }
    expect(
      screen.getByRole('group', { name: '도구' }).querySelector('svg.lucide-wrench'),
    ).toBeNull();
  });

  it('3D 에서는 시점 초기화, 2D 로 내려오면 3D 다시 시도를 누른다', () => {
    const { rerender } = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: '시점 초기화' }));
    expect(onResetView).toHaveBeenCalledOnce();
    expect(button('3D 다시 시도')).toBeNull();

    rerender(
      <ToolPalette
        view="2d"
        onResetView={onResetView}
        onRetry3d={onRetry3d}
        currentSceneVersion={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '3D 다시 시도' }));
    expect(onRetry3d).toHaveBeenCalledOnce();
    expect(button('시점 초기화')).toBeNull();
  });
});

describe('ToolPalette CCTV 창 버튼', () => {
  it('도구 모음에 CCTV 창 버튼이 없다(창은 3D 카메라 마커로만 연다)', () => {
    renderPalette();
    expect(button('CCTV 창')).toBeNull();
    expect(screen.queryByLabelText('CCTV 창')).toBeNull();
  });
});

describe('ToolPalette: 대기 화면이 위를 덮을 때', () => {
  const palette = () => screen.getByRole('group', { name: '도구' });

  it.each([
    ['작업이 끝났으면', [todayWork('DONE', 'ENDED')]],
    ['세팅이 끝나기 전이면', [todayWork('PLANNED', 'REPORT')]],
  ] as const)('%s 대기 화면이 떠 눌러도 Tab 으로도 닿지 않게 막는다(inert)', (_name, works) => {
    renderPalette({}, 'ADMIN', [...works]);
    expect(palette().hasAttribute('inert')).toBe(true);
  });

  it.each([
    ['세팅을 마친 작업이 있으면', [todayWork('PLANNED', 'SETUP_DONE')]],
    ['진행 중인 작업이 있으면', [todayWork('IN_PROGRESS', 'IN_PROGRESS')]],
    ['작업 목록을 아직 모르면', undefined],
  ] as const)('%s 막지 않는다', (_name, works) => {
    renderPalette({}, 'ADMIN', works && [...works]);
    expect(palette().hasAttribute('inert')).toBe(false);
  });

  it('구역 편집 중에는 대기 화면을 그리지 않으므로 막지 않는다', () => {
    act(() => startZoneEdit());
    renderPalette({}, 'ADMIN', [todayWork('DONE', 'ENDED')]);
    expect(palette().hasAttribute('inert')).toBe(false);
  });
});

describe('ToolPalette 이름표', () => {
  it('늦게 뜨는 브라우저 기본 title 대신 빨리 뜨는 이름표를 쓴다', () => {
    renderPalette();
    for (const name of ['시점 초기화', '맵 재생성']) {
      expect(screen.getByRole('button', { name }).getAttribute('title')).toBeNull();
    }
  });
});

describe('ToolPalette 역할별 도구', () => {
  it('관리자는 맵 재생성을 쓴다', () => {
    renderPalette();
    expect(button('시점 초기화')).toBeTruthy();
    expect(button('맵 재생성')).toBeTruthy();
  });

  it.each(['VIEWER', 'FOREMAN'] as const)('%s 는 시점 초기화만 쓴다', (role) => {
    renderPalette({}, role);
    expect(button('시점 초기화')).toBeTruthy();
    expect(button('맵 재생성')).toBeNull();
    // 숨긴 요소는 접근성 이름이 비므로 이름(aria-label)으로 직접 찾는다.
    expect(screen.queryByLabelText('맵 재생성')).toBeNull();
  });
});

describe('ToolPalette 맵 재생성 도구 숨기기', () => {
  // 숨긴 요소는 접근성 이름이 비므로 이름(aria-label)으로 직접 찾는다.
  const hiddenTool = () => screen.getByLabelText('맵 재생성');

  it('편집 중에도 떼지 않고 숨기기만 하며, 끄면 다시 보인다', () => {
    renderPalette();
    expect(hiddenTool().hasAttribute('hidden')).toBe(false);

    act(() => startZoneEdit());
    expect(button('맵 재생성')).toBeNull();
    expect(hiddenTool().hasAttribute('hidden')).toBe(true);

    act(() => stopZoneEdit());
    expect(button('맵 재생성')).toBeTruthy();
  });
});

describe('ToolPalette 작업 관리 이동', () => {
  it('세팅에서 구역을 발행한 뒤 편집 중이어도 작업 관리 이동 버튼을 두지 않는다(세팅 구역 단계가 작업 관리로 돌려보낸다)', () => {
    renderPalette();
    act(() => {
      startZoneEdit();
      useSetupFlowStore.setState({ zonesCommitted: true });
    });
    expect(button('작업 관리(TBM)로 이동')).toBeNull();
  });
});

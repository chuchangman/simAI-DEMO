import type {
  Viewer3DHandle,
  Viewer3DProps,
  ViewerStatus,
  ViewerTarget,
} from '@/features/viewer3d';
import { ZoneEditDialog } from '@/features/work/preflight/ZoneEditDialog';
import { sceneHandlers } from '@/mocks/scenes';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock } from '@/mocks/zones';
import { useBoxEditStore } from '@/store/boxEdit.store';
import { useSessionStore } from '@/store/session.store';
import { useZoneEditStore } from '@/store/zoneEdit.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test', getToken: () => 'mock-token.admin' }) };
});

// 3D 뷰어 대역: 준비를 한 번 알리고, 고르기·초점 명령을 기록한다(고르면 3D 클릭처럼 선택을 알린다).
const fakeViewer = vi.hoisted(() => ({ select: vi.fn(), focus: vi.fn() }));
vi.mock('@/features/viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/viewer3d')>();
  const { useEffect, useImperativeHandle } = await import('react');
  function FakeViewer({ ref, onStatusChange, onSelectionChange }: Viewer3DProps) {
    useImperativeHandle(
      ref,
      () =>
        ({
          select: (target: ViewerTarget) => {
            fakeViewer.select(target);
            onSelectionChange?.(target);
            return { ok: true };
          },
          focus: (target: ViewerTarget) => {
            fakeViewer.focus(target);
            return { ok: true };
          },
          clearSelection: () => ({ ok: true }),
        }) as unknown as Viewer3DHandle,
    );
    useEffect(() => {
      onStatusChange?.({ phase: 'ready', mode: 'LIVE', error: null } as ViewerStatus);
    }, [onStatusChange]);
    return <div data-testid="viewer3d" />;
  }
  return { ...actual, Viewer3D: FakeViewer };
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  const staticObjects = createStaticObjectsMock();
  const zonesMock = createZonesMock({ staticObjects: staticObjects.store });
  server.resetHandlers(...zonesMock.handlers, ...staticObjects.handlers, ...sceneHandlers);
  fakeViewer.select.mockClear();
  fakeViewer.focus.mockClear();
  useZoneEditStore.getState().clear();
  useBoxEditStore.getState().clear();
  signIn('ADMIN');
});
afterEach(() => {
  cleanup();
  useSessionStore.setState({ session: undefined });
});

function signIn(role: 'ADMIN' | 'VIEWER') {
  useSessionStore.setState({
    session: { accessToken: 'mock-token.admin', user: { id: 'admin', role } },
  });
}

function renderDialog(zoneId: string, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ZoneEditDialog zoneId={zoneId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('ZoneEditDialog', () => {
  it('세팅의 구역 단계(3D + 구역 편집 도구)를 창 안에 두고, 연 구역이 처음부터 골라져 있다', async () => {
    renderDialog('z-02');
    const dialog = screen.getByRole('dialog', { name: '구역 편집' });
    expect(within(dialog).getByRole('heading', { name: '구역 편집' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: '가상 레이아웃' })).toBeTruthy();

    // 편집 도구가 그 구역(단상 구역)을 고른 채 열린다.
    const picker = (await within(dialog).findByRole('combobox', {
      name: '구역 선택',
    })) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe('z-02'));
    expect((within(dialog).getByRole('textbox', { name: '이름' }) as HTMLInputElement).value).toBe(
      '단상 구역',
    );
    // 3D 도 그 구역을 고르고 초점을 맞춘다.
    await waitFor(() =>
      expect(fakeViewer.select).toHaveBeenCalledWith({ type: 'zone', id: 'z-02' }),
    );
    await waitFor(() =>
      expect(fakeViewer.focus).toHaveBeenCalledWith({ type: 'zone', id: 'z-02' }),
    );
  }, 30_000);

  it('열릴 때 한 번만 고르고, 이후 사용자가 고른 구역을 되돌리지 않는다', async () => {
    renderDialog('z-02');
    const picker = (await screen.findByRole('combobox', {
      name: '구역 선택',
    })) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe('z-02'));

    fireEvent.change(picker, { target: { value: 'z-04' } });
    await waitFor(() => expect(picker.value).toBe('z-04'));
    // 구역·3D 상태가 바뀌어도 처음 구역으로 돌아가지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(picker.value).toBe('z-04');
  }, 30_000);

  it('닫기 단추와 Esc 가 창을 닫는다', async () => {
    const onClose = renderDialog('z-04');
    const dialog = screen.getByRole('dialog', { name: '구역 편집' });
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('관리자가 아니면 편집 도구는 없고 3D 칸만 있다', async () => {
    signIn('VIEWER');
    renderDialog('z-04');
    const dialog = screen.getByRole('dialog', { name: '구역 편집' });
    expect(await within(dialog).findByTestId('viewer3d')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: '구역 선택' })).toBeNull();
  }, 30_000);
});

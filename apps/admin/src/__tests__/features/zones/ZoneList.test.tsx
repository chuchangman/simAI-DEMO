import { CommitBlockedError, commitErrorText } from '@/features/zones/commitErrors';
import type { ZoneCommitRequest } from '@/features/zones/types';
import { UNPUBLISHED_TEXT } from '@/features/zones/useConfigApply';
import { ZoneList } from '@/features/zones/ZoneList';
import { createStaticObjectsMock } from '@/mocks/staticObjects';
import { createZonesMock, MOCK_ZONES, type ZonesMock } from '@/mocks/zones';
import { useSessionStore, type Role } from '@/store/session.store';
import { useZoneEditStore } from '@/store/zoneEdit.store';
import { stopZoneEdit, useZoneEditModeStore } from '@/store/zoneEditMode.store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return {
    api: createHttp({
      baseUrl: 'http://api.test',
      getToken: () => 'mock-token.admin',
    }),
  };
});

// 3D 뷰어 호스트 대신 선택(zone:…)과 선택 호출 기록만 가진 작은 대역을 쓴다. 구역 목록은 실제 useZones 가 받는다.
const viewport = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    selectedKey: null as string | null,
    selectCalls: [] as unknown[][],
    clearCalls: 0,
    listeners,
    emit: () => listeners.forEach((fn) => fn()),
  };
});
vi.mock('@/features/layout/SpatialViewportHost', async () => {
  const { useSyncExternalStore } = await import('react');
  const { useZones } = await vi.importActual<typeof import('@/features/zones/useZones')>(
    '@/features/zones/useZones',
  );
  return {
    useSpatialViewport: () => {
      const selectedKey = useSyncExternalStore(
        (fn) => {
          viewport.listeners.add(fn);
          return () => viewport.listeners.delete(fn);
        },
        () => viewport.selectedKey,
      );
      const { zones, raw, failed } = useZones();
      return {
        zones,
        zonesRaw: raw,
        zonesFailed: failed,
        selectedKey,
        selectedZoneId: selectedKey?.startsWith('zone:') ? selectedKey.slice('zone:'.length) : null,
        selectTarget: (...args: unknown[]) => {
          viewport.selectCalls.push(args);
          const { type, id } = args[0] as { type: string; id: string };
          viewport.selectedKey = `${type}:${id}`;
          viewport.emit();
        },
        clearSelection: () => {
          viewport.clearCalls += 1;
          viewport.selectedKey = null;
          viewport.emit();
        },
      };
    },
  };
});

const server = setupServer();
const log: string[] = [];
const commits: ZoneCommitRequest[] = [];
let zonesMock: ZonesMock;

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET') log.push(`${request.method} ${path}`);
  });
});
afterAll(() => server.close());

function signInAs(role: Role) {
  useSessionStore.setState({
    session: { accessToken: 'mock-token.admin', user: { id: role.toLowerCase(), role } },
  });
}

beforeEach(() => {
  const staticObjects = createStaticObjectsMock();
  zonesMock = createZonesMock({ staticObjects: staticObjects.store });
  server.resetHandlers(
    http.post('*/api/zones/commit', async ({ request }) => {
      commits.push((await request.clone().json()) as ZoneCommitRequest);
      return undefined;
    }),
    ...zonesMock.handlers,
    ...staticObjects.handlers,
  );
  log.splice(0, log.length);
  commits.splice(0, commits.length);
  viewport.selectedKey = null;
  viewport.selectCalls.splice(0, viewport.selectCalls.length);
  viewport.clearCalls = 0;
  viewport.listeners.clear();
  useZoneEditStore.getState().clear();
  stopZoneEdit();
  signInAs('ADMIN');
});
afterEach(() => {
  cleanup();
  useSessionStore.setState({ session: undefined });
});

async function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ZoneList />
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: '위험 구역' });
  // 관리자에게는 구역을 받기 전에도 패널(새 구역 추가 버튼)이 있으므로 행이 나올 때까지 기다린다.
  await screen.findAllByRole('listitem');
  return view;
}

/** 구역 이름 버튼의 이름(앞에 등급 글자가 붙는다). 연필 버튼의 이름과 겹치지 않는다. */
const nameButtonOf = (name: string) => new RegExp(`^(위험|경고)\\s*${name}$`);
const rowOf = (name: RegExp) =>
  screen.getAllByRole('listitem').find((item) => name.test(item.textContent ?? ''))!;
const rowButton = (name: RegExp) => within(rowOf(name)).getAllByRole('button')[0]!;
const pencilOf = (name: RegExp) => within(rowOf(name)).getByRole('button', { name: /이름 고치기/ });
const editor = () => screen.getByRole('textbox', { name: '구역 이름' }) as HTMLInputElement;
const typeName = (value: string) => fireEvent.change(editor(), { target: { value } });
const writes = () => [...log];
const NEW_NAME_TEXT = '새 이름';
/** 보냈다면 도착했을 만큼 기다린다(보내지 않았다는 시험이 너무 일찍 통과하지 않게). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

describe('구역 목록', () => {
  it('이름만 보이고(구역 번호 없음) 위험한 등급이 먼저이며 등급 색 띠가 붙는다', async () => {
    await renderList();
    expect(screen.getByRole('heading', { name: '위험 구역' })).toBeTruthy();
    expect(screen.queryByText(/z-0\d/)).toBeNull();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '위험 개구부 구역',
      '경고 단상 구역',
    ]);
    expect(rowButton(/개구부 구역/).className).toContain('border-sev-critical');
    expect(rowButton(/단상 구역/).className).toContain('border-sev-high');
  });

  async function renderEmptyList() {
    server.use(http.get('*/api/zones', () => HttpResponse.json([])));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ZoneList />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(client.getQueryData(['zones'])).toEqual([]));
    return view;
  }

  it('구역이 없고 목록 받기도 실패하지 않았으면 관리자가 아닌 역할에게는 아무것도 그리지 않는다', async () => {
    signInAs('VIEWER');
    const { container } = await renderEmptyList();
    expect(container.innerHTML).toBe('');
  });

  it('구역이 없어도 관리자는 새 구역 추가 버튼으로 편집 모드에 들어간다', async () => {
    await renderEmptyList();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    act(() => screen.getByRole('button', { name: '새 구역 추가' }).click());
    expect(useZoneEditModeStore.getState().editing).toBe(true);
    expect(viewport.selectCalls).toEqual([]);
  });

  it('새 구역 추가 버튼은 이미 골라 둔 구역을 풀고 편집 모드를 켠다(편집 패널이 그 구역이 아니라 새 구역으로 열리게)', async () => {
    viewport.selectedKey = 'zone:z-04';
    await renderList();
    act(() => screen.getByRole('button', { name: '새 구역 추가' }).click());
    expect(viewport.clearCalls).toBe(1);
    expect(viewport.selectCalls).toEqual([]);
    expect(useZoneEditModeStore.getState().editing).toBe(true);
  });

  it('구역이 있어도 관리자에게만 새 구역 추가 버튼이 보인다', async () => {
    await renderList();
    expect(screen.getByRole('button', { name: '새 구역 추가' })).toBeTruthy();
    cleanup();
    signInAs('VIEWER');
    await renderList();
    expect(screen.queryByRole('button', { name: '새 구역 추가' })).toBeNull();
  });

  it('목록을 받지 못하면 그 알림을 보인다', async () => {
    server.use(http.get('*/api/zones', () => HttpResponse.error()));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ZoneList />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('구역 목록을 불러오지 못했습니다.')).toBeTruthy();
  });

  describe.each(['VIEWER', 'FOREMAN'] as const)('%s 역할', (role) => {
    beforeEach(() => signInAs(role));

    it('연필이 없고, 행을 누르면 강조만 하며(카메라 이동·편집 모드 없음) 다시 누르면 해제한다', async () => {
      await renderList();
      expect(screen.queryByRole('button', { name: /이름 고치기/ })).toBeNull();

      act(() => rowButton(/개구부 구역/).click());
      expect(viewport.selectCalls).toEqual([[{ type: 'zone', id: 'z-04' }]]);
      expect(useZoneEditModeStore.getState().editing).toBe(false);
      expect(rowButton(/개구부 구역/).getAttribute('aria-pressed')).toBe('true');
      expect(rowButton(/단상 구역/).getAttribute('aria-pressed')).toBe('false');

      act(() => rowButton(/개구부 구역/).click());
      expect(viewport.clearCalls).toBe(1);
      expect(rowButton(/개구부 구역/).getAttribute('aria-pressed')).toBe('false');
    });

    it('다른 행을 누르면 그 구역으로 강조를 옮긴다', async () => {
      await renderList();
      act(() => rowButton(/개구부 구역/).click());
      act(() => rowButton(/단상 구역/).click());
      expect(viewport.selectCalls.map(([target]) => target)).toEqual([
        { type: 'zone', id: 'z-04' },
        { type: 'zone', id: 'z-02' },
      ]);
      expect(viewport.clearCalls).toBe(0);
    });
  });

  it('관리자가 행을 누르면 그 구역을 고르고(카메라 이동) 편집 모드를 켠다', async () => {
    await renderList();
    act(() => rowButton(/단상 구역/).click());
    expect(viewport.selectCalls).toEqual([[{ type: 'zone', id: 'z-02' }, { focus: true }]]);
    expect(useZoneEditModeStore.getState().editing).toBe(true);
  });

  describe('이름 고치기(관리자)', () => {
    it('연필을 누르면 그 자리에 입력이 나오고 Enter 로 구역 UPDATE 와 발행을 한 번에 보낸다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      expect(editor().value).toBe('개구부 구역');
      typeName(`  ${NEW_NAME_TEXT} `);
      fireEvent.keyDown(editor(), { key: 'Enter' });

      expect(await screen.findByRole('button', { name: nameButtonOf('새 이름') })).toBeTruthy();
      expect(screen.queryByRole('textbox', { name: '구역 이름' })).toBeNull();
      expect(writes()).toEqual(['POST /api/zones/commit']);
      expect(commits).toHaveLength(1);
      expect(commits[0]).toMatchObject({
        zone: {
          op: 'UPDATE',
          zone_id: 'z-04',
          body: { name: NEW_NAME_TEXT, severity: 'CRITICAL' },
        },
        publish: true,
      });
      expect(commits[0]).not.toHaveProperty('surface');
      // 이름만 바꿨으니 편집 모드·선택은 건드리지 않는다.
      expect(useZoneEditModeStore.getState().editing).toBe(false);
      expect(viewport.selectCalls).toEqual([]);
    });

    it('포커스를 잃으면 저장하고, 이름을 안 바꿨으면 보내지 않고 닫는다', async () => {
      await renderList();
      act(() => pencilOf(/단상 구역/).click());
      typeName('고친 이름');
      fireEvent.blur(editor());
      expect(await screen.findByRole('button', { name: nameButtonOf('고친 이름') })).toBeTruthy();
      expect(commits).toHaveLength(1);

      act(() => pencilOf(/고친 이름/).click());
      typeName(' 고친 이름  ');
      fireEvent.blur(editor());
      await waitFor(() => expect(screen.queryByRole('textbox', { name: '구역 이름' })).toBeNull());
      expect(commits).toHaveLength(1);
    });

    it('Enter 뒤 포커스가 빠져도 한 번만 저장한다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });
      fireEvent.blur(editor());
      await screen.findByRole('button', { name: nameButtonOf('새 이름') });
      await settle();
      expect(commits).toHaveLength(1);
    });

    it('이름을 저장하는 동안 구역 행을 눌러도 편집 모드를 켜지 않는다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });
      act(() => rowButton(/단상 구역/).click());
      expect(useZoneEditModeStore.getState().editing).toBe(false);
      await screen.findByRole('button', { name: nameButtonOf('새 이름') });
    });

    it('Escape 는 저장하지 않고 입력을 닫는다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Escape' });
      await settle();
      expect(screen.queryByRole('textbox', { name: '구역 이름' })).toBeNull();
      expect(rowButton(/개구부 구역/)).toBeTruthy();
      expect(writes()).toEqual([]);
    });

    it('빈 이름과 40자를 넘긴 이름은 알리고 보내지 않으며 입력을 그대로 둔다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName('   ');
      fireEvent.keyDown(editor(), { key: 'Enter' });
      expect(await screen.findByText('이름을 입력하세요.')).toBeTruthy();
      expect(editor().value).toBe('   ');

      typeName('ㄱ'.repeat(41));
      fireEvent.keyDown(editor(), { key: 'Enter' });
      expect(await screen.findByText('이름은 40자까지입니다.')).toBeTruthy();
      expect(writes()).toEqual([]);

      // 고치면 다시 저장할 수 있고, 알림은 닫을 때 지운다.
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });
      expect(await screen.findByRole('button', { name: nameButtonOf('새 이름') })).toBeTruthy();
    });

    it('한글 조합 중 Enter 는 저장하지 않는다', async () => {
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true });
      fireEvent.keyDown(editor(), { key: 'Enter', keyCode: 229 });
      await settle();
      expect(commits).toHaveLength(0);
      expect(editor().value).toBe(NEW_NAME_TEXT);
    });

    it('그 사이 다른 관리자가 새 버전을 저장했으면 저장하지 않고 막힘 문구를 보이며 입력을 남긴다', async () => {
      await renderList();
      server.use(
        http.get('*/api/zones', () =>
          HttpResponse.json(
            MOCK_ZONES.map((zone) =>
              zone.zone_id === 'z-04' ? { ...zone, zone_version: zone.zone_version + 1 } : zone,
            ),
          ),
        ),
      );
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });
      expect(
        await screen.findByText(commitErrorText(new CommitBlockedError('zone', 'CHANGED'))),
      ).toBeTruthy();
      expect(commits).toHaveLength(0);
      expect(editor().value).toBe(NEW_NAME_TEXT);
    });

    it('저장은 됐는데 발행을 못 하면 알림과 다시 보내기가 뜨고, 다시 보내면 사라진다', async () => {
      zonesMock.failNextPublish('CURRENT_CALIBRATION_MISSING');
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });

      expect(await screen.findByText(UNPUBLISHED_TEXT)).toBeTruthy();
      expect(screen.getByText('유효한 보정 문서가 없어 현장에 반영할 수 없습니다.')).toBeTruthy();
      expect(screen.getByRole('button', { name: nameButtonOf('새 이름') })).toBeTruthy();
      expect(commits.map((request) => request.publish)).toEqual([true, false]);

      // 보내는 동안에도 알림이 숨으므로, 발행 요청이 나간 것을 먼저 기다리고 응답이 끝난 뒤 알림이 없는지 본다.
      act(() => screen.getByRole('button', { name: '다시 보내기' }).click());
      await waitFor(() => expect(writes().at(-1)).toBe('POST /api/config-bundles'));
      await settle();
      expect(screen.queryByText(UNPUBLISHED_TEXT)).toBeNull();
    });

    it('저장하면 그 구역 초안의 이름 고침만 버린다(다른 고침과 다른 구역 초안은 남는다)', async () => {
      const store = useZoneEditStore.getState();
      store.record('z-04');
      store.update('z-04', () => ({ patch: { name: '고치는 중', severity: 'HIGH' }, box: null }));
      store.update('z-02', () => ({ patch: { name: '다른 구역 초안' }, box: null }));
      await renderList();
      act(() => pencilOf(/개구부 구역/).click());
      typeName(NEW_NAME_TEXT);
      fireEvent.keyDown(editor(), { key: 'Enter' });
      await screen.findByRole('button', { name: nameButtonOf('새 이름') });

      const { drafts, history } = useZoneEditStore.getState();
      expect(drafts['z-04']).toEqual({ patch: { severity: 'HIGH' }, box: null });
      expect(history['z-04']).toBeUndefined();
      expect(drafts['z-02']?.patch.name).toBe('다른 구역 초안');
    });
  });
});

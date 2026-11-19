import { GpuSettingsSection, toBody, toForm } from '@/features/gpu/GpuSettingsSection';
import type { GpuSettings } from '@/features/gpu/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw/http';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async () => {
  const { createHttp } = await import('@/lib/http');
  return { api: createHttp({ baseUrl: 'http://api.test' }) };
});

const settings: GpuSettings = {
  version_id: 3,
  provider: 'RUNPOD',
  preferred_gpu_types: ['NVIDIA H100 80GB HBM3', 'NVIDIA H100 PCIe'],
  preferred_regions: ['AP-JP-1', 'OC-AU-1'],
  cloud_type: 'SECURE',
  interruptible: false,
  max_price_per_hour_usd: null,
  auto_stop_idle_minutes: 30,
  runpod_template_id: 'tpl-simai',
  created_at_ms: 1_793_000_000_000,
};

const saved: unknown[] = [];
const server = setupServer(
  http.get('*/api/gpu/settings', () =>
    HttpResponse.json({
      settings,
      providers: [
        { id: 'RUNPOD', configured: true },
        { id: 'AWS', configured: false },
      ],
    }),
  ),
  http.post('*/api/gpu/settings', async ({ request }) => {
    const body = await request.json();
    saved.push(body);
    return HttpResponse.json({ ...settings, ...(body as object), version_id: 4 }, { status: 201 });
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  saved.length = 0;
});

function renderSection() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <GpuSettingsSection />
    </QueryClientProvider>,
  );
}

describe('GpuSettingsSection', () => {
  it('설정 페이지 GPU 구역: 목록에서 GPU·지역을 고르고 순서·유휴 기준·다음 켜기 적용 안내를 보이며, 버전·템플릿 ID 는 자세히 아래에 두고 준비 안 된 공급자는 비활성화한다(-733)', async () => {
    renderSection();
    await screen.findByLabelText('선호 GPU (위가 먼저)');
    expect(
      screen.getByText('다음 켜기부터 적용됩니다(자동 정지 시간은 켜져 있는 GPU 에도 바로 적용).'),
    ).toBeTruthy();
    expect(
      screen.getByText(/유휴 기준: 관제\(작업\)·세팅·녹화 업로드·분석 작업과 관리자 화면 조작/),
    ).toBeTruthy();

    // 선택 목록은 짧은 GPU 이름·나라 이름 지역으로 표시
    const gpuList = screen.getByRole('list', { name: '선호 GPU (위가 먼저) 선택 목록' });
    expect(gpuList.textContent).toContain('1. H100 SXM');
    expect(gpuList.textContent).toContain('2. H100 PCIe');
    const regionList = screen.getByRole('list', { name: '선호 지역 (위가 먼저) 선택 목록' });
    expect(regionList.textContent).toContain('1. 일본 AP-JP-1');
    expect(regionList.textContent).toContain('2. 호주 OC-AU-1');

    // 버전과 템플릿 ID 는 자세히(details) 안에 있다
    const details = screen.getByText('자세히').closest('details')!;
    expect(details).toBeTruthy();
    expect(details.textContent).toContain('버전 3');
    expect(details.textContent).toContain('RunPod 템플릿 ID');

    // 준비 안 된 공급자(AWS (준비 안 됨))는 선택 불가(disabled)
    const awsOption = screen.getByRole('option', { name: 'AWS (준비 안 됨)' }) as HTMLOptionElement;
    expect(awsOption.disabled).toBe(true);
    expect(screen.queryByLabelText('AWS 시작 템플릿 ID')).toBeNull();
    expect(screen.queryByLabelText(/API 키|비밀/)).toBeNull();

    // 목록에서 새 GPU 추가 및 순서 변경
    act(() =>
      fireEvent.change(screen.getByLabelText('선호 GPU (위가 먼저)'), {
        target: { value: 'NVIDIA L40S' },
      }),
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: 'H100 PCIe 위로' })));

    act(() =>
      fireEvent.change(screen.getByLabelText('시간당 가격 상한 (USD)'), {
        target: { value: '3.5' },
      }),
    );
    act(() =>
      fireEvent.change(screen.getByLabelText('자동 정지 (유휴 분, 0 = 끔)'), {
        target: { value: '45' },
      }),
    );
    act(() => fireEvent.click(screen.getByLabelText('스팟(중단될 수 있음)')));
    act(() => fireEvent.click(screen.getByRole('button', { name: '저장' })));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('저장했습니다'));
    expect(saved).toEqual([
      {
        provider: 'RUNPOD',
        preferred_gpu_types: ['NVIDIA H100 PCIe', 'NVIDIA H100 80GB HBM3', 'NVIDIA L40S'],
        preferred_regions: ['AP-JP-1', 'OC-AU-1'],
        cloud_type: 'SECURE',
        interruptible: true,
        max_price_per_hour_usd: 3.5,
        auto_stop_idle_minutes: 45,
        runpod_template_id: 'tpl-simai',
        aws_launch_template_id: null,
        aws_subnet_ids: [],
        aws_security_group_ids: [],
      },
    ]);
  });

  it('AWS 가 준비된 경우 고르면 인스턴스 종류·가용 영역 목록과 자세히 아래 시작 템플릿·서브넷·보안 그룹 칸을 보이고 그대로 보낸다(S15P31A101-703, -733)', async () => {
    server.use(
      http.get('*/api/gpu/settings', () =>
        HttpResponse.json({
          settings,
          providers: [
            { id: 'RUNPOD', configured: true },
            { id: 'AWS', configured: true },
          ],
        }),
      ),
    );
    renderSection();
    await screen.findByLabelText('선호 GPU (위가 먼저)');
    act(() => fireEvent.change(screen.getByLabelText('공급자'), { target: { value: 'AWS' } }));
    expect(screen.queryByLabelText('RunPod 템플릿 ID')).toBeNull();
    act(() =>
      fireEvent.change(screen.getByLabelText('선호 인스턴스 종류 (위가 먼저)'), {
        target: { value: 'g6e.2xlarge' },
      }),
    );
    act(() =>
      fireEvent.change(screen.getByLabelText('선호 인스턴스 종류 (위가 먼저)'), {
        target: { value: 'g7e.2xlarge' },
      }),
    );
    act(() =>
      fireEvent.change(screen.getByLabelText('선호 가용 영역 (위가 먼저)'), {
        target: { value: 'ap-northeast-2a' },
      }),
    );
    act(() =>
      fireEvent.change(screen.getByLabelText('AWS 시작 템플릿 ID'), {
        target: { value: ' lt-0123456789abcdef0 ' },
      }),
    );
    act(() =>
      fireEvent.change(screen.getByLabelText('서브넷 (가용 영역마다 하나, 비우면 기본 VPC)'), {
        target: { value: 'subnet-0aaa1111bbbb2222c\n' },
      }),
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: '저장' })));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      provider: 'AWS',
      preferred_gpu_types: ['g6e.2xlarge', 'g7e.2xlarge'],
      preferred_regions: ['ap-northeast-2a'],
      aws_launch_template_id: 'lt-0123456789abcdef0',
      aws_subnet_ids: ['subnet-0aaa1111bbbb2222c'],
      aws_security_group_ids: [],
    });
  });

  it('선호 GPU 를 모두 빼면 보내지 않고 까닭을 보이며, 되돌리기는 불러온 값으로 돌린다', async () => {
    renderSection();
    await screen.findByLabelText('선호 GPU (위가 먼저)');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'H100 SXM 제거' })));
    act(() => fireEvent.click(screen.getByRole('button', { name: 'H100 PCIe 제거' })));
    act(() => fireEvent.click(screen.getByRole('button', { name: '저장' })));
    expect(screen.getByRole('alert').textContent).toBe('선호 GPU 를 하나 이상 고르세요.');
    expect(saved).toEqual([]);
    act(() => fireEvent.click(screen.getByRole('button', { name: '되돌리기' })));
    const gpuList = screen.getByRole('list', { name: '선호 GPU (위가 먼저) 선택 목록' });
    expect(gpuList.textContent).toContain('1. H100 SXM');
    expect(gpuList.textContent).toContain('2. H100 PCIe');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('toBody: 빈 가격은 상한 없음, 빈 템플릿은 null, 자동 정지 범위 검사', () => {
    const form = toForm(settings);
    expect(toBody({ ...form, maxPrice: '', templateId: ' ' })).toMatchObject({
      max_price_per_hour_usd: null,
      runpod_template_id: null,
    });
    expect(toBody({ ...form, autoStop: '-1' })).toBe('자동 정지는 0~1440 분입니다.');
    expect(toBody({ ...form, maxPrice: '0' })).toBe(
      '가격 상한은 0 보다 큰 숫자이거나 비워 둡니다.',
    );
  });
});

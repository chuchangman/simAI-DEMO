import {
  AWS_GPU_CATALOG,
  AWS_REGION_CATALOG,
  formatRegion,
  gpuErrorMessage,
  RUNPOD_GPU_CATALOG,
  RUNPOD_REGION_CATALOG,
  shortGpuName,
} from '@/features/gpu/gpuStatus';
import type { GpuOfferRow, GpuSettings, GpuSettingsBody } from '@/features/gpu/types';
import { useCachedGpuOffers, useGpuSettings } from '@/features/gpu/useGpu';
import { Button } from '@simai/ui/components/button';
import { Input } from '@simai/ui/components/input';
import { Label } from '@simai/ui/components/label';
import { Textarea } from '@simai/ui/components/textarea';
import { useState } from 'react';

// GPU 설정(S15P31A101-702, -705 부터 관리자 「설정」 페이지의 GPU 구역, 관리자만). 저장하면 서버에 새 버전으로 쌓인다(이력, 덮어쓰지 않음).
// 공급자·선호 GPU 목록(재고 표 값에서 고름, 위가 먼저. -705 부터 켜기 표는 모든 GPU 를 보이고 이 목록은 정렬·기본 선택에만 쓴다)·선호 지역 목록·
// 클라우드 종류·온디맨드/스팟·시간당 가격 상한(비우면 없음)·자동 정지 분(0 이면 끔)·RunPod 템플릿 ID.
// 비밀 값(API 키·부팅 비밀값)은 화면에 두지 않는다(EC2 .env·RunPod Secrets).
// AWS(S15P31A101-703): 선호 GPU 칸이 인스턴스 종류, 선호 지역 칸이 가용 영역이고 시작 템플릿·서브넷·보안 그룹 칸을 더 받는다.
// 서버에서 AWS 를 켜지 않았거나 자격 증명이 없으면 공급자 목록에 「준비 안 됨」으로 보이고 고를 수 없다(S15P31A101-733).

export interface GpuSettingsForm {
  provider: GpuSettings['provider'];
  gpuTypes: string;
  regions: string;
  cloudType: GpuSettings['cloud_type'];
  interruptible: boolean;
  maxPrice: string;
  autoStop: string;
  templateId: string;
  awsTemplateId: string;
  awsSubnets: string;
  awsGroups: string;
}

export const toForm = (s: GpuSettings): GpuSettingsForm => ({
  provider: s.provider,
  gpuTypes: s.preferred_gpu_types.join('\n'),
  regions: s.preferred_regions.join('\n'),
  cloudType: s.cloud_type,
  interruptible: s.interruptible,
  maxPrice: s.max_price_per_hour_usd === null ? '' : String(s.max_price_per_hour_usd),
  autoStop: String(s.auto_stop_idle_minutes),
  templateId: s.runpod_template_id ?? '',
  awsTemplateId: s.aws_launch_template_id ?? '',
  awsSubnets: (s.aws_subnet_ids ?? []).join('\n'),
  awsGroups: (s.aws_security_group_ids ?? []).join('\n'),
});

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** 입력을 저장 본문으로. 틀린 칸이 있으면 그 까닭 */
export function toBody(form: GpuSettingsForm): GpuSettingsBody | string {
  const gpuTypes = lines(form.gpuTypes);
  const regions = lines(form.regions);
  if (gpuTypes.length === 0) return '선호 GPU 를 하나 이상 고르세요.';
  if (regions.length === 0) return '선호 지역을 하나 이상 고르세요.';
  const price = form.maxPrice.trim() === '' ? null : Number(form.maxPrice);
  if (price !== null && (!Number.isFinite(price) || price <= 0))
    return '가격 상한은 0 보다 큰 숫자이거나 비워 둡니다.';
  const autoStop = Number(form.autoStop);
  if (!Number.isInteger(autoStop) || autoStop < 0 || autoStop > 1440)
    return '자동 정지는 0~1440 분입니다.';
  return {
    provider: form.provider,
    preferred_gpu_types: gpuTypes,
    preferred_regions: regions,
    cloud_type: form.cloudType,
    interruptible: form.interruptible,
    max_price_per_hour_usd: price,
    auto_stop_idle_minutes: autoStop,
    runpod_template_id: form.templateId.trim() === '' ? null : form.templateId.trim(),
    aws_launch_template_id: form.awsTemplateId.trim() === '' ? null : form.awsTemplateId.trim(),
    aws_subnet_ids: lines(form.awsSubnets),
    aws_security_group_ids: lines(form.awsGroups),
  };
}

function gpuCatalogFor(
  provider: GpuSettings['provider'],
  offerRows: GpuOfferRow[] | undefined,
  selected: string[],
): { id: string; label: string }[] {
  const base = provider === 'AWS' ? AWS_GPU_CATALOG : RUNPOD_GPU_CATALOG;
  const map = new Map<string, string>();
  for (const item of base) {
    map.set(item.gpuType, item.memoryGb != null ? `${item.name} (${item.memoryGb}GB)` : item.name);
  }
  if (offerRows) {
    for (const row of offerRows) {
      if (!map.has(row.gpu_type)) {
        map.set(row.gpu_type, `${shortGpuName(row.gpu_type, row.name)} (${row.memory_gb}GB)`);
      }
    }
  }
  for (const id of selected) {
    if (!map.has(id)) {
      map.set(id, shortGpuName(id));
    }
  }
  return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
}

function regionCatalogFor(
  provider: GpuSettings['provider'],
  offerRegions: { region: string; name: string }[] | undefined,
  selected: string[],
): { id: string; label: string }[] {
  const base = provider === 'AWS' ? AWS_REGION_CATALOG : RUNPOD_REGION_CATALOG;
  const set = new Set<string>(base);
  if (offerRegions) {
    for (const r of offerRegions) set.add(r.region);
  }
  for (const r of selected) set.add(r);
  return Array.from(set).map((id) => ({ id, label: formatRegion(id) }));
}

export function GpuSettingsSection() {
  const { data, loading, loadError, save, saving, saveError, saved } = useGpuSettings(true);
  return (
    <section
      aria-labelledby="settings-gpu"
      className="flex flex-col rounded-xl bg-card text-card-foreground ring-1 ring-border"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 id="settings-gpu" className="text-base font-semibold">
          GPU
        </h2>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {saved && <span role="status">저장했습니다</span>}
        </span>
      </div>
      {loading && <p className="p-5 text-sm text-muted-foreground">불러오는 중…</p>}
      {loadError && (
        <p role="alert" className="p-5 text-sm">
          {gpuErrorMessage(loadError)}
        </p>
      )}
      {data && (
        <SettingsForm
          key={data.settings.version_id ?? 'default'}
          initial={toForm(data.settings)}
          versionId={data.settings.version_id}
          providers={data.providers}
          saving={saving}
          error={saveError ? gpuErrorMessage(saveError) : null}
          onSave={(body) => save(body)}
        />
      )}
    </section>
  );
}

function SettingsForm({
  initial,
  versionId,
  providers,
  saving,
  error,
  onSave,
}: {
  initial: GpuSettingsForm;
  versionId: number | null;
  providers: { id: string; configured: boolean }[];
  saving: boolean;
  error: string | null;
  onSave: (body: GpuSettingsBody) => void;
}) {
  const [form, setForm] = useState<GpuSettingsForm>(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const cachedOffers = useCachedGpuOffers();
  const set = <K extends keyof GpuSettingsForm>(key: K, value: GpuSettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const aws = form.provider === 'AWS';

  const selectedGpus = lines(form.gpuTypes);
  const selectedRegions = lines(form.regions);
  const sameProviderOffers = cachedOffers?.provider === form.provider ? cachedOffers : undefined;
  const gpuOptions = gpuCatalogFor(form.provider, sameProviderOffers?.gpu_types, selectedGpus);
  const regionOptions = regionCatalogFor(
    form.provider,
    sameProviderOffers?.regions,
    selectedRegions,
  );

  const setGpuList = (next: string[]) => set('gpuTypes', next.join('\n'));
  const setRegionList = (next: string[]) => set('regions', next.join('\n'));

  const handleProviderChange = (nextProvider: GpuSettings['provider']) => {
    setForm((f) => {
      if (f.provider === nextProvider) return f;
      if (nextProvider === initial.provider) {
        return {
          ...f,
          provider: nextProvider,
          gpuTypes: initial.gpuTypes,
          regions: initial.regions,
        };
      }
      return {
        ...f,
        provider: nextProvider,
        gpuTypes: '',
        regions: '',
      };
    });
  };

  const submit = () => {
    const body = toBody(form);
    if (typeof body === 'string') {
      setInvalid(body);
      return;
    }
    setInvalid(null);
    onSave(body);
  };

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        다음 켜기부터 적용됩니다(자동 정지 시간은 켜져 있는 GPU 에도 바로 적용).
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gpu-provider">공급자</Label>
        <select
          id="gpu-provider"
          value={form.provider}
          onChange={(e) => handleProviderChange(e.target.value === 'AWS' ? 'AWS' : 'RUNPOD')}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.configured && p.id !== form.provider}>
              {p.id === 'RUNPOD' ? 'RunPod' : 'AWS'}
              {p.configured ? '' : p.id === 'AWS' ? ' (준비 안 됨)' : ' (설정되지 않음)'}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <OrderedCatalogPicker
          id="gpu-types"
          label={aws ? '선호 인스턴스 종류 (위가 먼저)' : '선호 GPU (위가 먼저)'}
          selected={selectedGpus}
          options={gpuOptions}
          itemLabel={(id) => shortGpuName(id)}
          emptyText="선택된 GPU 가 없습니다."
          onChange={setGpuList}
        />
        <OrderedCatalogPicker
          id="gpu-regions"
          label={aws ? '선호 가용 영역 (위가 먼저)' : '선호 지역 (위가 먼저)'}
          selected={selectedRegions}
          options={regionOptions}
          itemLabel={(id) => formatRegion(id)}
          emptyText="선택된 지역이 없습니다."
          onChange={setRegionList}
        />
      </div>
      <fieldset className={aws ? 'hidden' : 'flex flex-wrap gap-x-6 gap-y-2 text-sm'}>
        <legend className="sr-only">클라우드 종류</legend>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="gpu-cloud"
            checked={form.cloudType === 'SECURE'}
            onChange={() => set('cloudType', 'SECURE')}
          />
          보안 클라우드
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="gpu-cloud"
            checked={form.cloudType === 'COMMUNITY'}
            onChange={() => set('cloudType', 'COMMUNITY')}
          />
          커뮤니티 클라우드
        </label>
      </fieldset>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <legend className="sr-only">요금 방식</legend>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="gpu-billing"
            checked={!form.interruptible}
            onChange={() => set('interruptible', false)}
          />
          온디맨드
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="gpu-billing"
            checked={form.interruptible}
            onChange={() => set('interruptible', true)}
          />
          스팟(중단될 수 있음)
        </label>
      </fieldset>
      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gpu-max-price">시간당 가격 상한 (USD)</Label>
          <Input
            id="gpu-max-price"
            inputMode="decimal"
            placeholder="없음"
            value={form.maxPrice}
            onChange={(e) => set('maxPrice', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gpu-auto-stop">자동 정지 (유휴 분, 0 = 끔)</Label>
          <Input
            id="gpu-auto-stop"
            inputMode="numeric"
            value={form.autoStop}
            onChange={(e) => set('autoStop', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            유휴 기준: 관제(작업)·세팅·녹화 업로드·분석 작업과 관리자 화면 조작이 모두 없는
            시간(준비 시간 제외).
          </p>
        </div>
      </div>
      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">
          자세히
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {versionId != null && <p className="text-xs text-muted-foreground">버전 {versionId}</p>}
          {aws ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gpu-aws-template">AWS 시작 템플릿 ID</Label>
                <Input
                  id="gpu-aws-template"
                  placeholder="lt-…"
                  value={form.awsTemplateId}
                  onChange={(e) => set('awsTemplateId', e.target.value)}
                />
              </div>
              <div className="grid gap-4 min-[480px]:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gpu-aws-subnets">
                    서브넷 (가용 영역마다 하나, 비우면 기본 VPC)
                  </Label>
                  <Textarea
                    id="gpu-aws-subnets"
                    rows={3}
                    placeholder="subnet-…"
                    value={form.awsSubnets}
                    onChange={(e) => set('awsSubnets', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gpu-aws-groups">보안 그룹 (비우면 시작 템플릿)</Label>
                  <Textarea
                    id="gpu-aws-groups"
                    rows={3}
                    placeholder="sg-…"
                    value={form.awsGroups}
                    onChange={(e) => set('awsGroups', e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gpu-template">RunPod 템플릿 ID</Label>
              <Input
                id="gpu-template"
                value={form.templateId}
                onChange={(e) => set('templateId', e.target.value)}
              />
            </div>
          )}
        </div>
      </details>
      {(invalid ?? error) && (
        <p role="alert" className="text-sm">
          {invalid ?? error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setForm(initial);
            setInvalid(null);
          }}
          disabled={saving}
        >
          되돌리기
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  );
}

function OrderedCatalogPicker({
  id,
  label,
  selected,
  options,
  itemLabel,
  emptyText,
  onChange,
}: {
  id: string;
  label: string;
  selected: string[];
  options: { id: string; label: string }[];
  itemLabel: (id: string) => string;
  emptyText: string;
  onChange: (next: string[]) => void;
}) {
  const addItem = (value: string) => {
    if (!value || selected.includes(value)) return;
    onChange([...selected, value]);
  };
  const removeItem = (value: string) => {
    onChange(selected.filter((item) => item !== value));
  };
  const moveItem = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    const [picked] = next.splice(index, 1);
    next.splice(target, 0, picked!);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value=""
        onChange={(e) => addItem(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
      >
        <option value="">목록에서 추가…</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id} disabled={selected.includes(opt.id)}>
            {opt.label}
          </option>
        ))}
      </select>
      {selected.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ol
          aria-label={`${label} 선택 목록`}
          className="flex flex-col gap-1 rounded-lg border border-border p-1.5 text-xs"
        >
          {selected.map((item, idx) => {
            const name = itemLabel(item);
            return (
              <li
                key={item}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 odd:bg-muted/40"
              >
                <span className="truncate font-medium">
                  {idx + 1}. {name}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`${name} 위로`}
                    disabled={idx === 0}
                    onClick={() => moveItem(idx, -1)}
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${name} 아래로`}
                    disabled={idx === selected.length - 1}
                    onClick={() => moveItem(idx, 1)}
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`${name} 제거`}
                    onClick={() => removeItem(item)}
                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    제거
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

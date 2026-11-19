import {
  availabilityLabel,
  cellUsable,
  formatRegion,
  formatUsd,
  gpuErrorMessage,
  LAUNCH_PREP_TIME_NOTE,
  needsTierConfirm,
  RECOMMENDED_TOOLTIP,
  rowUsable,
  shortGpuName,
  TIER_LABEL,
  TIER_TEXT,
  TIER_TONE,
  tierWarning,
} from '@/features/gpu/gpuStatus';
import type { GpuOfferCell, GpuOfferRow, GpuOffers } from '@/features/gpu/types';
import { useGpuLaunch, useGpuOffers } from '@/features/gpu/useGpu';
import { Button } from '@simai/ui/components/button';
import { cn } from '@simai/ui/lib/utils';
import { useState } from 'react';

// GPU 켜기(S15P31A101-702, -705, -733): 기본은 「켤 수 있음」(또는 「모름」) 칸이 있는 줄만 보이고 「전체 보기」로 나머지 줄을 펼친다.
// 「추천」 표시는 켤 수 있는 줄에만 붙이고, 등급 꼬리표(권장 미만·제한·위험)는 마우스를 올리면 뜻을 보인다.
// 지역 머리줄은 나라 이름+코드(예: 일본 AP-JP-1)로, GPU 이름은 짧은 이름(H100 SXM 등)으로 통일하며 예상 준비 시간을 함께 안내한다.

interface Pick {
  gpuType: string;
  region: string;
}

const ENGINE_NOTE = '엔진 캐시가 GPU 종류별이라 첫 실행은 엔진 빌드로 몇 분 더 걸립니다.';

function cellOf(offers: GpuOffers, pick: Pick): GpuOfferCell | undefined {
  return offers.cells.find((c) => c.gpu_type === pick.gpuType && c.region === pick.region);
}

function rowOf(offers: GpuOffers, gpuType: string): GpuOfferRow | undefined {
  return offers.gpu_types.find((g) => g.gpu_type === gpuType);
}

/** 행 이름 옆 표시: 「추천」(H100·H200 계열 중 켤 수 있는 줄만) 또는 VRAM 등급(권장 미만·제한·위험, hover 설명 포함) */
function RowBadge({ row, usable }: { row: GpuOfferRow; usable: boolean }) {
  if (row.recommended && usable) {
    return (
      <span
        title={RECOMMENDED_TOOLTIP}
        className="rounded px-1.5 text-xs font-semibold text-primary ring-1 ring-primary/50"
      >
        추천
      </span>
    );
  }
  if (!row.tier || row.tier === 'RECOMMENDED') return null;
  return (
    <span
      title={tierWarning(row.tier) ?? undefined}
      className={cn('rounded px-1.5 text-xs font-semibold ring-1', TIER_TONE[row.tier])}
    >
      {TIER_LABEL[row.tier]}
    </span>
  );
}

export function GpuLaunchForm({
  onLaunched,
  onCancel,
}: {
  onLaunched: () => void;
  onCancel: () => void;
}) {
  const { offers, pending, error: offersError } = useGpuOffers(true);
  const { launch, pending: launching, error: launchError } = useGpuLaunch();
  const [picked, setPicked] = useState<Pick | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (pending) return <p className="p-5 text-sm text-muted-foreground">재고를 확인하는 중…</p>;
  if (offersError || !offers) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <p role="alert" className="text-sm">
          {gpuErrorMessage(offersError)}
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            닫기
          </Button>
        </div>
      </div>
    );
  }

  const fallback = offers.default
    ? { gpuType: offers.default.gpu_type, region: offers.default.region }
    : null;
  const pick = picked ?? fallback;
  const cell = pick ? cellOf(offers, pick) : undefined;
  const row = pick ? rowOf(offers, pick.gpuType) : undefined;
  const baseGpu = offers.default?.gpu_type ?? offers.gpu_types[0]?.gpu_type;
  const otherGpu = pick !== null && baseGpu !== undefined && pick.gpuType !== baseGpu;
  const usableRows = offers.gpu_types.filter((g) => rowUsable(offers, g.gpu_type));
  const hasHiddenRows = usableRows.length > 0 && usableRows.length < offers.gpu_types.length;
  const visibleRows = showAll || usableRows.length === 0 ? offers.gpu_types : usableRows;
  // 보이는 줄 어디에도 켤 수 있는 칸이 없는 지역 열은 접는다(칸이 모두 「없음」이라 눌러도 못 고른다, S15P31A101-752). 고른 칸의 지역은 남긴다.
  const visibleRegions = offers.regions.filter(
    (r) =>
      pick?.region === r.region ||
      visibleRows.some((g) =>
        cellUsable(cellOf(offers, { gpuType: g.gpu_type, region: r.region })),
      ),
  );
  const foldedRegions = offers.regions.filter((r) => !visibleRegions.includes(r));
  const preferred = offers.default;

  const submit = () => {
    if (!pick) return;
    // 기본 그대로면 서버가 고르게 비운다(그 사이 재고가 바뀌어도 같은 규칙으로 다시 고른다)
    const body = picked === null ? {} : { gpu_type: pick.gpuType, region: pick.region };
    launch(body, { onSuccess: onLaunched });
  };

  if (confirming && pick) {
    const tier = row?.tier ?? null;
    const warning = tierWarning(tier);
    const strong = needsTierConfirm(tier);
    const displayGpu = shortGpuName(pick.gpuType, row?.name);
    return (
      <div className="flex flex-col gap-4 p-5" data-testid="gpu-launch-confirm">
        <p className="text-sm font-semibold">GPU 를 켤까요?</p>
        <p className="text-sm">
          {displayGpu}
          {row?.memory_gb != null && ` (${row.memory_gb}GB)`} · {formatRegion(pick.region)}
          {cell?.price_per_hour_usd != null && ` · 시간당 ${formatUsd(cell.price_per_hour_usd)}`}
        </p>
        <p className="text-xs text-muted-foreground">{LAUNCH_PREP_TIME_NOTE}</p>
        {warning && tier && tier !== 'RECOMMENDED' && (
          <p
            role={strong ? 'alert' : undefined}
            data-testid="gpu-tier-warning"
            className={cn('text-sm', TIER_TEXT[tier])}
          >
            {warning}
          </p>
        )}
        {otherGpu && <p className="text-sm text-muted-foreground">{ENGINE_NOTE}</p>}
        {launchError && (
          <p role="alert" className="text-sm">
            {gpuErrorMessage(launchError)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={launching}>
            취소
          </Button>
          <Button
            variant={strong ? 'destructive' : 'default'}
            onClick={submit}
            disabled={launching}
          >
            {launching ? '켜는 중…' : strong ? '그래도 켜기' : '켜기'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{LAUNCH_PREP_TIME_NOTE}</span>
        {hasHiddenRows && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '켤 수 있는 줄만 보기' : `전체 보기 (${offers.gpu_types.length}종)`}
          </Button>
        )}
      </div>
      <div className="max-h-[min(56vh,520px)] overflow-x-hidden overflow-y-auto">
        <table className="w-full border-separate border-spacing-1 text-sm" aria-label="GPU 재고">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr>
              <th className="text-left font-normal text-muted-foreground" />
              {visibleRegions.map((r) => (
                <th
                  key={r.region}
                  scope="col"
                  className="px-2 text-left font-normal whitespace-nowrap text-muted-foreground"
                >
                  {formatRegion(r.region)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((g) => {
              const gpuName = shortGpuName(g.gpu_type, g.name);
              const usable = rowUsable(offers, g.gpu_type);
              return (
                <tr key={g.gpu_type}>
                  <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {gpuName}
                      {g.memory_gb != null && (
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          {g.memory_gb}GB
                        </span>
                      )}
                      <RowBadge row={g} usable={usable} />
                    </span>
                  </th>
                  {visibleRegions.map((r) => {
                    const c = cellOf(offers, { gpuType: g.gpu_type, region: r.region });
                    const selected = pick?.gpuType === g.gpu_type && pick.region === r.region;
                    const ok = cellUsable(c);
                    const label = availabilityLabel(c);
                    const isPreferred =
                      preferred?.gpu_type === g.gpu_type && preferred.region === r.region;
                    return (
                      <td key={r.region}>
                        <button
                          type="button"
                          disabled={!ok}
                          aria-pressed={selected}
                          aria-label={`${gpuName} ${r.region} ${label}`}
                          onClick={() => setPicked({ gpuType: g.gpu_type, region: r.region })}
                          className={cn(
                            'flex w-full min-w-[72px] flex-col items-start rounded-md px-2 py-1.5 text-left ring-1 ring-border',
                            selected && 'bg-point-soft ring-2 ring-primary',
                            !ok && 'cursor-not-allowed opacity-40',
                          )}
                        >
                          <span className="whitespace-nowrap">{label}</span>
                          {isPreferred && (
                            <span className="text-xs font-semibold text-primary">선호 1순위</span>
                          )}
                          <span className="font-mono text-xs text-muted-foreground">
                            {c?.price_per_hour_usd != null
                              ? `${formatUsd(c.price_per_hour_usd)}/h`
                              : '—'}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {foldedRegions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          재고 없음: {foldedRegions.map((r) => formatRegion(r.region)).join(', ')}
        </p>
      )}
      {!pick && (
        <p className="text-sm">
          기본으로 켤 칸이 없습니다. 표에서 고르거나 설정의 GPU 구역에서 선호 지역을 바꾸세요.
        </p>
      )}
      {otherGpu && <p className="text-sm text-muted-foreground">{ENGINE_NOTE}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          취소
        </Button>
        <Button
          disabled={!pick || (cell !== undefined && !cellUsable(cell))}
          onClick={() => setConfirming(true)}
        >
          켜기
        </Button>
      </div>
    </div>
  );
}

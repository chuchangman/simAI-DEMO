import { z } from 'zod';

// GPU 켜기·끄기·GPU 설정 REST(S15P31A101-702, 서버 domain/gpu, 관리자만, 계약 밖).
// 상태는 G1 GET /api/gpu/sessions/current(-699)에 -702 가 더한 launch·power·stop_block 을 함께 읽는다.
// 다른 티켓이 더하는 필드(예: -701 gateway)는 모르는 채로 받는다(looseObject).

/** 점 하나의 서버 상태. STARTING = 켠 뒤 G1 등록 전, PREPARING = 등록했지만 준비 전 */
export const gpuPowerSchema = z.enum(['OFF', 'STARTING', 'PREPARING', 'CONNECTED', 'ERROR']);
export type GpuPower = z.infer<typeof gpuPowerSchema>;

const nullableNumber = z.number().nullable();
const nullableString = z.string().nullable();

export const gpuSessionSchema = z.looseObject({
  session_id: z.string(),
  state: z.enum(['ACTIVE', 'ENDED']),
  stage: z.string(),
  stage_reason_code: nullableString.optional(),
  // 단계 설명(-700 부팅 보고. 예: VLLM 「VLM 가중치·vLLM 기동 대기」, READY 「vLLM 미준비(시한 초과): …」, S15P31A101-706 이 읽는다)
  stage_detail: nullableString.optional(),
  stage_at_ms: nullableNumber.optional(),
  provider: z.string(),
  instance_id: z.string(),
  gpu_type: z.string(),
  region: nullableString,
  price_per_hour_usd: nullableNumber,
  registered_at_ms: z.number(),
  elapsed_ms: z.number(),
  tier0_link: z.enum(['CONNECTED', 'DISCONNECTED']),
  // 호스트 CPU 측정(S15P31A101-740, 부팅 보고의 host_cpu 마지막 값). 보고가 없으면 null·없음, 못 잰 칸은 null
  host_cpu: z
    .looseObject({
      model: nullableString.optional(),
      logical_cpus: nullableNumber.optional(),
      cpu_quota: nullableNumber.optional(),
      single_thread_score: nullableNumber.optional(),
      measured_at: z.number().optional(),
    })
    .nullable()
    .optional(),
  // 꺼진 기능 문구 목록(S15P31A101-747, 부팅 보고의 disabled_features 마지막 값). 없음·null 은 아직 모름, 빈 배열은 꺼진 것 없음
  disabled_features: z.array(z.string()).nullable().optional(),
  // 꺼진 기능 쉬운 말 항목(S15P31A101-756, 부팅 보고 1.3.0 의 disabled_notices 마지막 값). 없음·null 은 아직 모름(옛 보고기면 disabled_features 만 있음)
  disabled_notices: z
    .array(
      z.looseObject({
        key: z.string(),
        level: z.enum(['warning', 'info']),
        text: z.string(),
        detail: z.string().nullish(),
      }),
    )
    .nullable()
    .optional(),
});
export type GpuSession = z.infer<typeof gpuSessionSchema>;

export const gpuLaunchSchema = z.looseObject({
  launch_id: z.string(),
  state: z.enum(['REQUESTED', 'RUNNING', 'FAILED', 'STOPPED']),
  provider: z.string(),
  gpu_type: z.string(),
  region: z.string(),
  cloud_type: z.string(),
  interruptible: z.boolean(),
  price_per_hour_usd: nullableNumber,
  requested_by: nullableString,
  requested_at_ms: z.number(),
  instance_id: nullableString,
  ended_at_ms: nullableNumber,
  end_reason: nullableString,
  failure_code: nullableString,
});
export type GpuLaunch = z.infer<typeof gpuLaunchSchema>;

export const gpuStatusSchema = z.looseObject({
  session: gpuSessionSchema.nullable(),
  server_time_ms: z.number(),
  launch: gpuLaunchSchema.nullable().optional(),
  power: gpuPowerSchema.optional(),
  stop_block: z.enum(['LIVE', 'SETUP']).nullable().optional(),
});
export type GpuStatus = z.infer<typeof gpuStatusSchema>;

// UNKNOWN: 제공은 되는데 실시간 재고를 모름(AWS, S15P31A101-703). 고를 수 있고 켜 봐야 안다
export const gpuStockSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN']);
export type GpuStock = z.infer<typeof gpuStockSchema>;

// VRAM 등급(S15P31A101-705, 서버 GpuTiers 가 정한다. 명세 3.12 최소 사양): 80GB급 추천 / 48GB급 권장 미만 / 24GB급 제한(Tier 0 관제만) / 그 미만 위험(경계 74·44·22GB)
export const gpuTierSchema = z.enum(['RECOMMENDED', 'BELOW_RECOMMENDED', 'LIMITED', 'RISKY']);
export type GpuTier = z.infer<typeof gpuTierSchema>;

// 행은 공급자 카탈로그의 모든 GPU(서버가 추천 → VRAM 등급 → 선호 순서로 정렬해 준다, -705).
// available: 켤 수 있음 true / 없음 false / 모름 null(AWS). 공급자가 개수를 주면 count 로 「n개」를 보인다(지금은 어느 공급자도 주지 않음).
export const gpuOffersSchema = z.object({
  provider: z.string(),
  cloud_type: z.string(),
  interruptible: z.boolean(),
  max_price_per_hour_usd: nullableNumber,
  gpu_types: z.array(
    z.object({
      gpu_type: z.string(),
      name: z.string(),
      memory_gb: nullableNumber,
      preferred: z.boolean().optional(),
      recommended: z.boolean().optional(),
      tier: gpuTierSchema.nullable().optional(),
      available: z.boolean().nullable().optional(),
    }),
  ),
  regions: z.array(z.object({ region: z.string(), name: z.string(), preferred: z.boolean() })),
  cells: z.array(
    z.object({
      gpu_type: z.string(),
      region: z.string(),
      stock: gpuStockSchema,
      available: z.boolean().nullable().optional(),
      count: nullableNumber.optional(),
      price_per_hour_usd: nullableNumber,
      within_cap: z.boolean(),
    }),
  ),
  default: z.object({ gpu_type: z.string(), region: z.string() }).nullable(),
  fetched_at_ms: z.number(),
});
export type GpuOffers = z.infer<typeof gpuOffersSchema>;
export type GpuOfferCell = GpuOffers['cells'][number];
export type GpuOfferRow = GpuOffers['gpu_types'][number];

export const gpuSettingsSchema = z.object({
  version_id: nullableNumber,
  provider: z.enum(['RUNPOD', 'AWS']),
  preferred_gpu_types: z.array(z.string()),
  preferred_regions: z.array(z.string()),
  cloud_type: z.enum(['SECURE', 'COMMUNITY']),
  interruptible: z.boolean(),
  max_price_per_hour_usd: nullableNumber,
  auto_stop_idle_minutes: z.number(),
  runpod_template_id: nullableString,
  // AWS 칸(S15P31A101-703, 비밀 아님): 시작 템플릿·서브넷·보안 그룹
  aws_launch_template_id: nullableString.optional(),
  aws_subnet_ids: z.array(z.string()).optional(),
  aws_security_group_ids: z.array(z.string()).optional(),
  created_at_ms: nullableNumber,
});
export type GpuSettings = z.infer<typeof gpuSettingsSchema>;
export type GpuSettingsBody = Omit<GpuSettings, 'version_id' | 'created_at_ms'>;

export const gpuSettingsResponseSchema = z.object({
  settings: gpuSettingsSchema,
  providers: z.array(z.object({ id: z.string(), configured: z.boolean() })),
});
export type GpuSettingsResponse = z.infer<typeof gpuSettingsResponseSchema>;

/** 켜기 요청. 비우면 서버가 추천 → 선호 순서 × 재고 × 가격 상한으로 고른다 */
export interface GpuLaunchBody {
  gpu_type?: string;
  region?: string;
}

// contracts/ 에서 생성한 파일이다. 손으로 고치지 않는다.
// 다시 만들기: pnpm --filter @simai/contracts generate


/**
 * RunPod Tier 0 → EC2, 10 Hz (명세 12.3, 5.2). I1 LIVE 계약이므로 Lead 승인 없이 의미를 바꾸지 않는다. 1.1.0 필드 추가(마이너, Lead 승인 S15P31A101-37): payload.input_provenance(입력 출처, 명세 20.4·AGENTS 규칙 7), position_xy 설명 보강(관측이 없을 때의 시각 기준, 의미 변경 없음). 1.2.0 필드 추가(마이너, Lead 승인 2026-10-18, S15P31A101-169): payload.config_version(이 상태를 만든 tick 의 구성 묶음 버전). 1.3.0 필드 추가(마이너, 사용자 승인 2026-10-18, S15P31A101-170): tracks[].surface_source(지지 표면 출처 observed/inferred, 접지점이 있을 때만), tracks[].aliases(병합으로 이 ID 에 합쳐진 이전 World ID). 1.4.0 필드 추가(마이너, 사용자 승인 2026-10-18, S15P31A101-172): tracks[].head_z_validity(관절 게이트가 낸 head_z 유효성. head_z 값은 VALID 일 때만 싣는다). 2.0.0 의미 변경(메이저, 사용자 승인 2026-10-19, S15P31A101-179): head_z_validity 가 UNCERTAIN 이면 head_z·head_z_sigma 에 그 UNCERTAIN 값을 싣는다(1.x 에서는 null). 그래서 2.0.0 부터 head_z 가 수라는 것만으로 VALID 라고 읽을 수 없고 head_z_validity 를 반드시 함께 확인한다. 1.x 문서는 1.x 규칙(UNCERTAIN ↔ null)으로 검사한다. 2.1.0 필드 추가(마이너, Lead 승인 2026-10-20, S15P31A101-201): tracks[].split_from(분할로 생긴 새 ID 에만 원래 ID, 그 Track 이 살아 있는 동안 늘 같은 값), identity_revision 설명 보강(병합·분할 모두 교정 차수를 올린다). 2.0.x 이하 문서는 split_from 을 싣지 않는다.
 */
export type WorldStateMessage = (Envelope & {
[k: string]: unknown
} & {
msg_type?: "world_state"
payload: WorldStatePayload
})
/**
 * 사람 한 명의 World 상태 (명세 5.2 World 위치의 정의)
 */
export type WorldTrack = ({
[k: string]: unknown
} & {
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
world_id: string
/**
 * UTC epoch 밀리초
 */
t_last_valid: number
/**
 * 명세 6.1
 */
observation_state: ("OBSERVED" | "PREDICTED" | "UNKNOWN")
/**
 * 명세 5.2. 관측 상태와 별도
 */
track_lifecycle: ("TENTATIVE" | "CONFIRMED" | "OCCLUDED" | "LOST")
identity_confidence: ("HIGH" | "MEDIUM" | "LOW" | "IDENTITY_UNCERTAIN")
/**
 * ID 교정 차수 (명세 5.2 ID 교정 기록). 교정(병합·분할)이 있을 때만 오르고 내려가지 않는다. 병합하면 남는 ID 의 값은 합쳐진 두 ID 의 identity_revision 중 큰 값 + 1 이다. 그래서 그 ID 가 겪은 병합 횟수나 aliases 개수와 같지 않을 수 있다(예: C 가 B 에 합쳐진 뒤 B 가 A 에 합쳐지면 A 는 0 → 2, aliases [B, C]). 병합으로 합쳐진 이전 ID 는 aliases. 분할(2.1.0 설명 보강, S15P31A101-201)하면 원래 ID 와 갈라져 나간 새 ID 의 값을 둘 중 큰 값 + 1 로 함께 올리고 별칭은 바꾸지 않는다. 새 ID 는 처음에 0 으로 나왔다가 분할이 확정된 시각에 오른다(새 ID 의 split_from 도 그 시각부터 실린다). 그래서 aliases 가 그대로인데 identity_revision 이 오른 원래 ID 는 분할된 것이고, 그 시각 split_from 에 이 ID 를 실은 트랙이 갈라져 나간 쪽이다
 */
identity_revision: number
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
split_from?: string
/**
 * 병합(ID 교정)으로 이 World ID 에 합쳐져 더 이상 쓰이지 않는 이전 World ID (명세 5.2 ID 교정 기록, 1.3.0). 합쳐진 순서대로이고, 합쳐진 ID 가 들고 있던 별칭도 이어 붙인다(연쇄 병합: Y 가 X 에, 그 뒤 Z 가 X 에 합쳐지면 [Y, Z]). 중복 없고 자기 world_id 는 넣지 않는다. 병합하면 남는 ID 의 identity_revision 이 오르므로(값 규칙은 identity_revision 설명) 소비자는 identity_revision 이 오른 것을 보고 이 목록으로 '이 ID 로 합쳐진 이전 ID' 를 알고, 이전 ID 로 들고 있던 트랙·이력을 이 ID 로 잇는다. 진행 중 이벤트의 ID 교정은 risk_event_transition 의 ID 교정 전이로 따로 오고, 이벤트의 world_ids 는 발생 당시 원본 ID 를 그대로 둔다. 덮어쓰지 않음(AGENTS 규칙 6): 한 번 실린 별칭은 이 Track 이 살아 있는 동안(LOST 뒤 같은 ID 로 다시 이어진 경우 포함) 빠지지 않고 뒤에만 붙는다. 별칭이 없으면 싣지 않는다(빈 배열 불가). 선택 필드: 없으면 별칭이 없거나 이전 버전 송신 측이다
 * 
 * @minItems 1
 * 
 * Items: 세션 단위 익명 World ID (예: w-0012)
 */
aliases?: [string, ...(string)[]]
frame_age_ms?: number
position_xy: Vec2
position_xy_sigma: Vec21
/**
 * 삼각측량한 골반. 2대 이상 유효 관측이 없으면 null
 */
pelvis_xyz: (WorldXyz | null)
/**
 * 검증된 지지 표면 위의 위치. 접지 미확인이면 null. Z=0으로 채우지 않는다.
 */
ground_anchor_xyz: (WorldXyz | null)
ground_anchor_sigma?: (Vec3 | null)
/**
 * 지지 표면(접지점)의 출처 (명세 5.2 접지 추정·가림 동안 유지, AGENTS 규칙 7 관측과 추정 구분, 1.3.0). observed = 이번 시각 Tier 0 가 관측한 VALID 발목이 그 지지 표면 높이에 있다(ContactEstimator 접촉 근거). inferred = 이번 시각 발목 근거가 없어 마지막으로 확인한 지지 표면·접지점을 유지한 값이다(가림 동안 유지, 바닥으로 바꾸지 않음. 이때 z_validity·contact_validity 는 UNCERTAIN 이고 ground_anchor_sigma 가 커진다). ground_anchor_xyz 가 있을 때만 싣고, null 이면 싣지 않는다(모르는 접지의 출처를 지어내지 않음, 스키마로 막음). 1.3.0 이상 송신 측은 ground_anchor_xyz 가 있으면 늘 싣는다(송신 측 계약 시험). 선택 필드라 이 필드가 없는 문서(이전 버전 송신 측)는 출처를 모르는 것이고, 소비자는 observed 로 가정하지 않는다. 메시 표면 출처(human_mesh_output 의 surface_source, defs surface_source)와 이름만 같고 다른 필드다
 */
surface_source?: ("observed" | "inferred")
/**
 * floor 또는 등록 작업면 ID
 */
support_surface_id: (string | null)
/**
 * 명세 5.2: 근거가 부족하면 UNKNOWN
 */
support_surface_validity: ("VALID" | "UNCERTAIN" | "UNKNOWN")
contact_validity: ("VALID" | "UNCERTAIN" | "UNAVAILABLE")
z_validity: ("VALID" | "UNCERTAIN" | "UNAVAILABLE")
/**
 * 머리 꼭대기 높이(World Z, m, 명세 5.2: 귀·눈 Z 평균 + 오프셋). 관절 유효성 게이트가 낸 값이고, 값이 있어도 head_z_validity 를 반드시 확인한다(2.0.0). head_z_validity 가 VALID 면 VALID 귀·눈으로 만든 값, UNCERTAIN 이면 VALID 귀·눈이 없어 UNCERTAIN 귀·눈으로만 만든 값이다(사용자 결정 2026-10-19, 접지점 ground_anchor_xyz 와 z_validity 의 관계와 같다). UNCERTAIN 값은 확정 근거가 아니다: 위험 규칙은 이 값으로 '진입 없음'·'낙상 아님' 같은 판정 없음을 확정하지 않고, 쓰면 확인 필요(JOINT_UNCERTAIN, 명세 5.2·7.1)를 붙인다. UNAVAILABLE 이면 null 이다. 값은 Tier 0 관측(joint_source observed) 귀·눈에서만 만든다(HMR 등 추정 관절 금지, AGENTS 규칙 1·7). 1.x 문서에서는 VALID 일 때만 값이 있고 UNCERTAIN 은 null 이었다. head_z_validity 가 없는 문서(1.3.0 이하)에서 head_z 가 null 이면 이유를 모른다
 */
head_z: (number | null)
/**
 * head_z 의 Z 표준편차(m, 근거 귀·눈 삼각측량 Z 표준편차로 만든 값, 오프셋 불확실성 제외). head_z 가 null 이면 null 이고, 값이 있어도 σ 를 모르면 null 이다. UNCERTAIN 값의 σ 도 head_z_validity 와 함께 읽는다
 */
head_z_sigma?: (number | null)
/**
 * 이번 시각 관절 유효성 게이트가 낸 head_z 의 유효성 (명세 5.2 3D 관절 유효성 게이트, 7.1 JOINT_UNCERTAIN, 1.4.0, 2.0.0 의미 변경). VALID = VALID 귀·눈으로 만든 값, head_z 는 수. UNCERTAIN = VALID 귀·눈이 없어 UNCERTAIN 귀·눈으로만 만든 값, 2.0.0 부터 head_z 에 싣는다(수). 머리가 보이기는 했으나 확정할 근거가 없다는 뜻이고 머리가 없다거나 낮다는 뜻이 아니다. 확정 근거로 쓰지 않는다(head_z 설명). 1.x 문서의 UNCERTAIN 은 값을 싣지 않았다(head_z·head_z_sigma null). UNAVAILABLE = 좌표가 있는 귀·눈이 없거나 이번 시각 관측(클러스터)이 붙지 않았다, head_z·head_z_sigma 는 null. 스키마로 막는 짝: VALID ↔ 수, UNAVAILABLE ↔ null, UNCERTAIN 은 2.0.0 이상 ↔ 수·1.x ↔ null. 1.4.0 이상 송신 측은 늘 싣는다(송신 측 계약 시험). 선택 필드라 이 필드가 없는 문서(1.3.0 이하 송신 측)에서 head_z 가 null 이면 이유를 모르는 것이고, 소비자는 UNAVAILABLE 로 가정하지 않는다
 */
head_z_validity?: ("VALID" | "UNCERTAIN" | "UNAVAILABLE")
velocity?: Vec3
/**
 * 이번 상태에 기여한 카메라
 */
cameras: string[]
skeleton?: Skeleton
})
/**
 * 구역 판정용 수평 위치. 기본은 골반 XY, 없으면 검증된 접지점 XY, 둘 다 없으면 예측값(observation_state=PREDICTED). 관측이 없을 때는 t_last_valid 시각의 위치를 유지하고 불확실성(position_xy_sigma)을 2 m/s(명세 6.1 속도 상한 초기값) × 공백(t − t_last_valid)만큼 키운다. 속도로 옮기지 않는다(이중 외삽 금지: 위치 예측은 하류 시간 모델이 staleness 로 한다)
 * 
 * @minItems 2
 * @maxItems 2
 */
export type Vec2 = [number, number]
/**
 * @minItems 2
 * @maxItems 2
 */
export type Vec21 = [number, number]
/**
 * World 좌표 [x, y, z], 미터, Z-up
 * 
 * @minItems 3
 * @maxItems 3
 */
export type WorldXyz = [number, number, number]
/**
 * @minItems 3
 * @maxItems 3
 */
export type Vec3 = [number, number, number]
/**
 * EC2 → 뷰어, STOMP /topic/events (명세 12.4, 12.2). EC2 가 저장한 RiskEvent 의 화면용 projection 이다. LIVE 는 Tier 0 전이(risk_event_transition)로만 갱신하고, PLANNED·REPLAY·WHAT_IF 는 EC2 옆 Risk Engine 컨테이너 결과로 보고서·시뮬레이션 화면에만 쓴다. rationale 은 VLM 결과가 오면 갱신으로 채워진다. VLM 은 proposed_severity 로 상향 의견만 내고 severity 를 바꾸지 못한다. 1.3.0 필드 추가(마이너): confidence_reasons(확인 필요 이유, 7.1), resume_count(해소 후 재개 횟수, 6.4). 2.0.0 의미 변경(메이저, Lead 승인 2026-10-20, S15P31A101-200): 운영자 종료 해소 resolution(선택, LIVE 만). resolution 이 있는 RESOLVED 는 verification VERIFIED 를 요구하지 않는다. 뷰어는 운영자 종료를 관측 해소와 구분해 보여 준다. 1.x 문서에는 resolution 이 없다(1.x 규칙 그대로). 2.1.0 필드 추가(마이너, S15P31A101-206): 운영자 상향 기록 escalations(선택, LIVE 만, 5.4·FR-116). /topic/events 화면 규칙(12.4): 경보 대상은 source LIVE·severity CRITICAL·HIGH·lifecycle RAISED·UPDATED 이고, 확인 상태는 acks 로 읽는다(지금 경보 단계 이후 event_sequence 를 대상으로 한 확인만 소리를 멈춘다, 3.10). 2.2.0 값 추가(마이너, S15P31A101-519): confidence_reasons 에 PPE_UNKNOWN(R9 안전모 상태 모름, 명세 7.2). 2.3.0 필드 추가(마이너, S15P31A101-595): held_by_tier0(선택, LIVE 만) — 지금 Tier 0 가 이 이벤트를 활성으로 들고 있는지(EC2 파생값, 저장하지 않음). 관제 화면은 해소 전이면서 held_by_tier0 가 true 인 이벤트만 '진행 중'(경보 배너·소리·2D 평면 대상)으로 보이고, false 인 해소 전 이벤트는 '지난 관제 · 확인 필요'로 내린다. 이벤트 자체(lifecycle)는 바꾸지 않는다(3.2 복원 이벤트 자동 해소 금지). 없으면(이전 EC2) 해소 전 이벤트를 진행 중으로 읽는다. 2.4.0 값 추가(마이너, S15P31A101-664): resolution 에 병합 흡수 마감 IDENTITY_MERGED. 2.5.0 값 추가(마이너, S15P31A101-722): resolution 에 EC2 마감(server_close_resolution, kind WORK_ENDED·SESSION_ENDED·NOT_IN_SNAPSHOT). 그 이벤트를 들고 있던 Tier 0 가 사라졌거나(작업 종료·GPU 세션 종료) 살아 있는 Tier 0 의 스냅샷에 없어 해소 전이가 다시 오지 않을 이벤트를 EC2 가 닫은 기록이다(관측 해소·운영자 종료 아님, 검증 상태 그대로). 이 판이 LIVE 를 Tier 0 전이 밖에서 바꾸는 유일한 경우이고, 그 Tier 0 가 그 이벤트의 전이를 다시 보내면 Tier 0 쪽을 따른다. 관제 화면은 이런 이벤트를 관측 해소와 구분하고 「최근 해소」에 넣지 않는다.
 */
export type RiskEventMessage = (Envelope & {
[k: string]: unknown
} & {
msg_type?: "risk_event"
payload: RiskEventPayload
})
export type RiskEventPayload = ({
[k: string]: unknown
} & {
/**
 * UUIDv7 (시간 순서, 재시작·여러 현장에서도 충돌 없음). event_id 에 쓴다 (명세 3.2 식별자 규칙)
 */
event_id: string
/**
 * 반영한 마지막 전이의 sequence (LIVE)
 */
event_sequence?: number
rule_id: string
rule_version: number
/**
 * 판정 출처 (명세 7.1). 실제 알림 채널로 가는 것은 LIVE 뿐이다 (7.4, 11.4)
 */
source: ("LIVE" | "PLANNED" | "REPLAY" | "WHAT_IF")
/**
 * 명세 6.2, 6.4
 */
lifecycle: ("RAISED" | "UPDATED" | "RESOLVED")
/**
 * 해소 여부를 관측으로 확인할 수 있는지 (명세 6.2, 6.4). UNVERIFIABLE 이면 자동 해소하지 않는다
 */
verification: ("VERIFIED" | "UNVERIFIABLE")
/**
 * 규칙 결과. VLM 의견으로 바뀌지 않는다. 상향은 검증된 규칙 조건이나 운영자 확인을 거쳐 새 전이로만 반영한다 (5.4)
 */
severity: ("CRITICAL" | "HIGH" | "CAUTION" | "INFO")
/**
 * 증거 신뢰도 (명세 7.3). severity 와 독립이다
 */
confidence: ("HIGH" | "LOW")
/**
 * 확인 필요 (7.1). confidence_reasons 가 있으면 그 목록이 비어 있지 않은 것과 같다
 */
needs_check: boolean
confidence_reasons?: ConfidenceReasons
/**
 * 해소 후 재개 시간 안 재발생으로 이 이벤트를 다시 활성으로 돌린 횟수 (6.4 이벤트 재개, 1.3.0). LIVE 는 resumed 전이 수와 같다. 없으면 0
 */
resume_count?: number
/**
 * Items: 세션 단위 익명 World ID (예: w-0012)
 */
world_ids: string[]
zone_id: (string | null)
metrics: RuleMetrics
/**
 * VLM 근거 문장. 아직 없으면 null. 이벤트 상세 화면에만 쓰고 푸시를 다시 보내지 않는다 (10.1)
 */
rationale: (string | null)
/**
 * VLM 상향 의견. severity 보다 높은 등급만 허용, 하향·해소 의견은 표현할 수 없다
 */
proposed_severity: (("CRITICAL" | "HIGH" | "CAUTION" | "INFO") | null)
/**
 * LIVE 이벤트를 만든 Tier 0 인스턴스
 */
gateway_id?: string
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
config_version?: string
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
calibration_version?: string
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
scene_version?: string
/**
 * UTC epoch 밀리초
 */
raised_at?: number
/**
 * UTC epoch 밀리초
 */
updated_at?: number
resolved_at?: (number | null)
/**
 * 운영자 확인 기록(누가·어디서). 비어 있으면 미확인. 확인은 해소가 아니다
 */
acks?: OperatorAck[]
/**
 * LIVE 전달 구분 (3.2 재동기화). DELAYED_ACTIVE: 재동기화 후에도 활성이라 지연 알림. AUDIT_ONLY: 재동기화 중 해소돼 감사 기록으로만 복원
 */
delivery?: ("REALTIME" | "DELAYED_ACTIVE" | "AUDIT_ONLY")
/**
 * UUIDv7 (시간 순서, 재시작·여러 현장에서도 충돌 없음). event_id 에 쓴다 (명세 3.2 식별자 규칙)
 */
related_event_id?: string
/**
 * 관측이 아닌 해소(6.4). LIVE 의 RESOLVED 에만. 없으면 관측 해소다. 운영자 종료(2.0.0, kind OPERATOR_CLOSED)와 병합 흡수 마감(2.4.0, kind IDENTITY_MERGED, S15P31A101-657 이 I1 risk_event_transition 2.3.0 에 더한 것을 EC2 가 그대로 싣는다), EC2 마감(2.5.0, kind WORK_ENDED·SESSION_ENDED·NOT_IN_SNAPSHOT, S15P31A101-722: Tier 0 가 들고 있지 않아 해소 전이가 다시 오지 않을 이벤트를 EC2 가 닫음)
 */
resolution?: (OperatorResolution | IdentityMergeResolution | ServerCloseResolution)
/**
 * 지금 Tier 0 가 이 LIVE 이벤트를 활성으로 들고 있는가(2.3.0, S15P31A101-595). EC2 가 Tier 0 의 마지막 재동기화 스냅샷(event_state_snapshot.active_events)과 그 뒤 실시간 전이로 접은 집합에 있고, 그 Tier 0 에서 I1 메시지를 마지막으로 받은 지 유예 시간(초기값 60초) 안이면 true. EC2 가 다시 뜬 뒤 스냅샷을 받기 전, Tier 0 가 꺼진 지 유예 시간이 지난 뒤, 다른(새) Tier 0 의 스냅샷에 없으면 false. 만든 때의 값이라 바뀌면 /topic/events 나 목록 다시 받기(viewer_health.held_events_revision)로 고친다. 해소 여부·등급을 바꾸지 않는 표시용 파생값이다
 */
held_by_tier0?: boolean
/**
 * 운영자 상향 기록(2.1.0, 5.4·FR-116). 비어 있거나 없으면 상향 없음. LIVE 만. 뷰어는 규칙 판정 등급과 운영자 상향을 구분해 보여 준다
 */
escalations?: OperatorEscalation[]
})
/**
 * 확인 필요의 이유 (명세 7.1, 13.2 화면 표시, 1.3.0). 없으면(이전 버전) needs_check 만으로 읽는다
 * 
 * Items: '확인 필요'의 이유 (명세 7.1). Z_UNKNOWN: 지지 표면·높이 모름(z_validity UNAVAILABLE). PREDICTED: 위치가 관측이 아니라 예측·마지막 추정값(관측 상실 포함). PROVISIONAL_CALIB: 판정 위치를 만든 보정이 CALIBRATED 가 아님(PROVISIONAL·DRIFTED, UNCALIBRATED 에서 판정이 나온 경우 방어적으로. UNCALIBRATED 는 여전히 위치 기반 판단 불가이고 이 표시가 판정을 허용한다는 뜻이 아니다. R2·R3·R4 에만, PLANNED 계획 위치는 해당 없음, 명세 4.4, 계약 v6.0.0 의미 확장). SINGLE_VIEW: 2대 이상 유효 관측 없음. JOINT_UNCERTAIN: 근거 관절 UNCERTAIN. IDENTITY_UNCERTAIN: 카메라 간 연결이 애매함. PPE_UNKNOWN: 안전모·조끼 상태를 모름(PPE 상태 UNKNOWN·근거 만료·identity_revision 불일치·PPE 상태 없음). R9·R11 에만 붙고 이미 열린 R9·R11 을 유지할 때만 쓴다(명세 7.2 R9, 계약 v7.17.0 값 추가, S15P31A101-519). UNSPECIFIED: 확인 필요인데 생산자가 원인을 적지 않음(이유 목록 이전 형식의 needs_check=true 를 옮길 때만, 원인을 지어내지 않는다)
 */
export type ConfidenceReasons = ("Z_UNKNOWN" | "PREDICTED" | "PROVISIONAL_CALIB" | "SINGLE_VIEW" | "JOINT_UNCERTAIN" | "IDENTITY_UNCERTAIN" | "PPE_UNKNOWN" | "UNSPECIFIED")[]
/**
 * 운영자 확인(ACKNOWLEDGED) 한 건. 확인은 해소가 아니다 (명세 6.4). 누가 확인해도 노트북 반복 소리를 멈추고, 점멸 표시는 해소까지 유지한다. 누가 확인했는지는 저널에 남긴다 (3.2)
 */
export type OperatorAck = ({
[k: string]: unknown
} & {
/**
 * 확인을 만든 쪽(EC2 또는 노트북)이 발급. 중복 수신 제거용
 */
ack_id: string
/**
 * 운영자 확인이 들어온 곳: 관제 화면, 반장 PWA, 노트북 현장 확인 버튼 (명세 3.2, 3.10)
 */
channel: ("CONTROL_ROOM" | "FOREMAN_PWA" | "SITE_BUTTON")
/**
 * SITE 는 현장 확인 버튼(노트북)
 */
actor_role: ("ADMIN" | "FOREMAN" | "SITE")
/**
 * 계정 ID 또는 노트북 기기 ID. 사람 이름을 넣지 않는다 (명세 11.4-5)
 */
actor_id: string
/**
 * UTC epoch 밀리초
 */
acked_at: number
})
/**
 * EC2 → 뷰어, STOMP /topic/health (명세 12.2, 12.4, 6.2, 13장). EC2 가 Tier 0 health(I1), 노트북 하트비트, 구성 묶음 적용(config_ack), COMMITTED Scene 을 모아 1초마다(바뀌면 즉시) 보내는 화면용 상태다. Tier 0 health 원문은 tier0_health 에 그대로 싣는다(없으면 null). EC2 가 Tier 0 나 노트북 하트비트를 잃으면 system_health 는 UNSAFE_UNKNOWN 이다(3.2 이중 감시). Scene 불일치는 Tier 0 가 판정에 쓰는 scene_version(world_state)과 EC2 의 COMMITTED Scene 버전이 다를 때다(FR-12). 1.7.0: laptop.replay_test_alerts 선택 추가(EC2 재생 시험 알림 스위치, test_input 과 함께 「재생 시험 · 실제 알림 켜짐」 표시용, S15P31A101-736). 1.6.0: laptop.test_input 선택 추가(시험 입력 = 녹화 파일·합성 영상 재생 중, 관제 화면의 「녹화 재생 중 · 실제 알림 꺼짐」 표시용, S15P31A101-731). 1.5.0: person_names·watch_names 선택 추가(현장·날짜별 사람 표시 이름 해석 결과: 관리자 World ID 지정 > 배정 워치 기기 표시 이름 > '미확인 N', 워치 기기별 현장 표시 이름, S15P31A101-658). 1.4.0: held_events_revision 선택 추가(Tier 0 가 들고 있는 이벤트 집합의 판, 바뀌면 관제 앱이 이벤트 목록을 다시 받아 '진행 중'·'지난 관제'를 다시 가른다, S15P31A101-595). 1.3.0: re_setup 선택 추가(회전 자동 복구가 '현장 세팅 다시 하기'를 요구한 카메라, 관리자 상단 배너용, S15P31A101-480). 1.2.0: watches 선택 추가(워치 연결 상태, 확장 부록 C.6, S15P31A101-336). 1.1.0: scene.compatibility 선택 추가(S15P31A101-381). 1.0.0 신설(S15P31A101-206).
 */
export type ViewerHealthMessage = (Envelope & {
msg_type?: "viewer_health"
payload: ViewerHealthPayload
})
export type ViewerHealthPayload = ({
[k: string]: unknown
} & {
/**
 * UTC epoch 밀리초
 */
as_of: number
/**
 * 명세 6.2
 */
system_health: ("NOMINAL" | "DEGRADED" | "UNSAFE_UNKNOWN")
/**
 * NORMAL: Tier 0·노트북 모두 정상. REMOTE_LINK_LOST: Tier 0 하트비트는 끊겼지만 노트북이 Tier 0 정상을 알림(원격 전달 단절, 현장 경보 동작 중). CONTROL_HALTED: 노트북도 Tier 0 끊김·관제 정지를 알리거나, 노트북 하트비트가 없거나, Tier 0 처리가 멈춤(연결은 살아 있어도 t_latest_global 이 늘지 않음, 이때 tier0_link 는 CONNECTED 일 수 있다) (3.2, FR-11)
 */
remote_state: ("NORMAL" | "REMOTE_LINK_LOST" | "CONTROL_HALTED")
/**
 * EC2 ↔ Tier 0 I1 연결
 */
tier0_link: ("CONNECTED" | "DISCONNECTED")
laptop: {
/**
 * laptop_heartbeat 3회 누락이면 DISCONNECTED (3.10)
 */
link: ("CONNECTED" | "DISCONNECTED")
last_heartbeat_at: (number | null)
/**
 * 1.6.0(S15P31A101-731, 선택): 시험 입력(녹화 파일·합성 영상 재생) 중인가. EC2 가 노트북 하트비트 cameras[].source_kind(laptop_heartbeat 1.3.0)로 판정한다: 마지막 하트비트가 60초 안인 노트북 중 하나라도 FILE·SYNTHETIC 이면 true(S15P31A101-724 의 워치 진동 차단과 같은 판정). true 면 위험 이벤트는 기록·화면 표시만 하고 실제 알림(현장 경보 소리, 워치 진동)은 꺼져 있다(AGENTS 규칙 5). 관제 화면은 「녹화 재생 중 · 실제 알림 꺼짐」을 보인다. 없으면(이전 EC2) 모른다(관제 화면은 재생 표시를 하지 않는다)
 */
test_input?: boolean
/**
 * 1.7.0(S15P31A101-736, 선택): EC2 의 재생 시험 알림 스위치(SIMAI_REPLAY_TEST_ALERTS, 기본 꺼짐)가 켜져 있는가. 켜져 있으면 test_input 이 true 인 동안에도 EC2 워치 진동이 라이브처럼 나간다(AGENTS 규칙 5 의 시험용 예외, 현장 경보 단말 소리는 단말의 같은 이름 스위치가 따로 정한다). 관제 화면은 test_input 과 이 값이 모두 true 면 「녹화 재생 중 · 실제 알림 꺼짐」 대신 「재생 시험 · 실제 알림 켜짐」을 크게 보인다. 없으면(이전 EC2) false 로 본다
 */
replay_test_alerts?: boolean
}
/**
 * as_of − 마지막 world_state 의 t_latest_global(EC2 가 아는 시계 차이 보정 후). 받은 적 없거나 모르면 null
 */
data_age_ms: (number | null)
/**
 * 명세 4.4
 */
calibration_state: ("UNCALIBRATED" | "PROVISIONAL" | "CALIBRATED" | "DRIFTED")
config: {
/**
 * EC2 가 마지막으로 발행한 구성 묶음
 */
published_version: (string | null)
/**
 * Tier 0 config_ack 로 적용 확인된 버전
 */
applied_version: (string | null)
/**
 * 명세 6.2, 3.2. 어느 상태든 판정은 계속한다
 */
sync: ("CURRENT" | "PENDING" | "UNVERIFIED" | "STALE")
}
scene: {
/**
 * EC2 의 COMMITTED Scene(GET /api/scenes/current)
 */
committed_version: (string | null)
/**
 * 마지막 world_state.scene_version
 */
live_version: (string | null)
compatibility?: Scene
/**
 * 두 값이 모두 있고 다르면 true (FR-12 경고)
 */
mismatch: boolean
}
/**
 * 마지막으로 받은 I1 health 의 payload 그대로(health.schema.json). 받은 적 없으면 null
 */
tier0_health: ({

} | null)
/**
 * '현장 세팅 다시 하기'가 필요한 카메라 (1.3.0, 명세 4.4, 설계 auto-rotation-recovery). Tier 0 가 연결돼 있고 마지막 health(2.2.0 이상)의 re_setup 이 있을 때 그 값을 camera_id 오름차순으로 싣는다(빈 배열 = 필요한 카메라 없음). Tier 0 연결이 끊겼거나 health 를 받은 적 없거나 health 에 re_setup 이 없으면 싣지 않는다(모름, 재세팅 없음으로 읽지 않는다). 관리자 화면 상단 배너용 안내이며 system_health·경보는 바꾸지 않는다
 */
re_setup?: {
camera_id: string
/**
 * 사람이 읽는 사유 한 줄 (health.re_setup[].reason 그대로)
 */
reason: string
/**
 * UTC epoch 밀리초
 */
detected_at: number
}[]
/**
 * Tier 0 가 지금 활성으로 들고 있는 이벤트 집합(risk_event.held_by_tier0 의 근거)의 판 (1.4.0, S15P31A101-595). 재동기화 스냅샷으로 집합이 달라지거나 Tier 0 I1 수신이 유예 시간 넘게 없어 집합을 비울 때마다 바뀐다(EC2 가 다시 뜨면 앞머리가 달라진다). 값의 뜻은 없고 같음·다름만 본다. 관제 앱은 바뀌면 이벤트 목록(GET /api/events)을 다시 받는다. 이벤트 하나의 전이로 바뀐 것은 그 /topic/events 가 알리므로 판이 바뀌지 않는다. 없으면(이전 EC2) 다시 받지 않는다
 */
held_events_revision?: string
/**
 * 확장(부록 C.6): 등록된 워치(device.kind WATCH, 폐기 안 됨)의 I4 연결 상태. 워치는 개인 보조 채널이라 system_health·remote_state 에 넣지 않는다. 없으면 워치 확장을 쓰지 않는 EC2 다
 */
watches?: {
/**
 * 등록된 워치 수
 */
registered: number
/**
 * items 중 link 가 CONNECTED 인 수(활성 워치 수)
 */
connected: number
/**
 * device_id 오름차순
 */
items: {
/**
 * 송신 주체 식별자 (tier0-01, laptop-01, ec2). Tier 0 인스턴스 식별자가 이벤트의 gateway_id 다 (명세 12.1)
 */
device_id: string
/**
 * CONNECTED: I4 연결이 열려 있고 마지막 watch_heartbeat(연결 직후는 연결 시각)가 EC2 가 준 interval_ms × 3 안. LOST: 그 밖(끊김·한 번도 안 붙음, C.6 LOST)
 */
link: ("CONNECTED" | "LOST")
/**
 * EC2 가 이 워치의 watch_heartbeat 를 마지막으로 받은 EC2 시각. 받은 적 없으면 null
 */
last_heartbeat_at: (number | null)
/**
 * CONNECTED 일 때 마지막 하트비트의 watch.battery_pct, 그 밖 null
 */
battery_pct: (number | null)
/**
 * CONNECTED 일 때 마지막 하트비트의 watch.transport, 그 밖 null
 */
transport: ("WIFI" | "PHONE_BLUETOOTH" | "CELLULAR" | "UNKNOWN" | null)
}[]
}
/**
 * 현장 단위로 지속되는 워치 기기 표시 이름 목록(device_id 오름차순, 1.5.0, S15P31A101-658). watches.items 는 닫힌 객체라 이전 관제 앱 호환을 위해 payload 최상위에 둔다. 표시 이름이 지정된 등록 워치만 싣거나 전체 중 유효한 것만 싣는다
 */
watch_names?: {
/**
 * 송신 주체 식별자 (tier0-01, laptop-01, ec2). Tier 0 인스턴스 식별자가 이벤트의 gateway_id 다 (명세 12.1)
 */
device_id: string
/**
 * 사람·워치 표시 이름(1~20자, 앞뒤 공백·제어문자 금지, 중복 허용)
 */
display_name: string
}[]
/**
 * 현장·날짜(Asia/Seoul) 기준 사람별 해석된 표시 이름 목록(world_id 오름차순, 1.5.0, S15P31A101-658). 우선순위: WORLD_MANUAL(관리자 World ID 지정, 당일·병합 승계) > WATCH_DEVICE(배정된 워치 기기 표시 이름, 현장 지속) > UNIDENTIFIED('미확인 N', 현장·날짜별 1부터 단조 증가). I1 world_state 는 익명 World ID 만 유지하고 관제 앱이 어댑터 한 곳에서 합친다. 없으면 이전 EC2 다
 */
person_names?: {
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
world_id: string
/**
 * 사람·워치 표시 이름(1~20자, 앞뒤 공백·제어문자 금지, 중복 허용)
 */
display_name: string
/**
 * 해석된 이름 출처: WORLD_MANUAL(관리자 World ID 지정) · WATCH_DEVICE(배정 워치 기기 표시 이름) · UNIDENTIFIED(미확인 N)
 */
name_source: ("WORLD_MANUAL" | "WATCH_DEVICE" | "UNIDENTIFIED")
}[]
})
/**
 * EC2(source_id ec2) → 뷰어 STOMP /topic/avatar. EC2 가 아바타 스트림(avatar_pose_batch·avatar_asset)에서 사람별 가장 새 포즈만 남겨 다시 싣는다. 메시지 하나만으로 그릴 수 있게 포즈마다 그 포즈가 가리키는 자산의 내려받기 주소를 함께 싣는다(늦게 구독한 뷰어도 REST 없이 시작). 밀리면 버리고(사람별 최신만), 빠진 사람은 '갱신 없음'이지 '사라짐'이 아니다. 사람의 존재·위치·접지·관측 상태·ID 신뢰도는 /topic/world(world_state)가 정본이고, 이 메시지는 관절 회전과 외형만 더한다(명세 13.1, 20.4). /topic/world·/topic/events 는 바뀌지 않는다. 1.0.0 신설(S15P31A101-249).
 */
export type AvatarFrameMessage = (Envelope & {
msg_type?: "avatar_frame"
payload: AvatarFramePayload
})
/**
 * 리그 모델 좌표(glTF Y-up 자산 좌표)를 World(m, 오른손, +Z 상방)로 돌리는 회전. 똑바로 선 사람은 'X 축 +π/2 뒤 World Z 축 방향 회전'. Three.js 변환 (x, z, −y)는 뷰어 어댑터에서만 곱한다
 * 
 * @minItems 3
 * @maxItems 3
 */
export type AxisAngle = [number, number, number]
/**
 * 축각 회전(rotation vector) [rx, ry, rz], 라디안. 방향 = 회전축, 길이 = 회전각(0 ≤ 길이 ≤ π, 길이 검사는 계약 시험). 회전 표현은 이것 하나다(쿼터니언·행렬·오일러로 싣지 않는다, 명세 12.1 각도는 라디안). 뷰어는 쿼터니언으로 바꿔 보간한다
 * 
 * @minItems 3
 * @maxItems 3
 */
export type AxisAngle1 = [number, number, number]
/**
 * 뷰어가 내려받을 자산. 주소는 EC2 REST 경로(같은 출처, 관제 앱 인증)로만 싣는다. 객체 저장소 주소·서명 주소·다른 호스트는 싣지 않는다
 */
export type ViewerAsset = ({
[k: string]: unknown
} & {
[k: string]: unknown
} & {
[k: string]: unknown
} & {
/**
 * UTC epoch 밀리초
 */
stream_epoch: number
/**
 * avatar_asset identity_revision 그대로(자산을 만들 때 본 ID 교정 차수). 포즈의 identity_revision 보다 클 수 없다. 작으면 ID 교정 뒤 유지한 마지막 확정 외형이다(계약 시험, 설계 'ID 교정 뒤 외형')
 */
identity_revision: number
/**
 * EC2 REST 의 아바타 파일 경로(예: /api/avatars/w-0012/epochs/1760342000000/versions/3/mesh.glb, epoch 를 넣어 워커 재시작 뒤 같은 버전과 겹치지 않게). 스킴·호스트·쿼리(서명)·퍼센트 인코딩 없는 같은 출처 경로만, 마디는 점으로 시작하지 않는다(.. 경로 탈출 금지)
 */
mesh_url: string
/**
 * 내려받은 파일 확인과 뷰어 캐시 키
 */
mesh_sha256: string
mesh_format: ("GLB_SKINNED" | "GLTF_SKINNED")
/**
 * pose.joint_rotations 길이와 같아야 한다. 다르면 캡슐
 */
joint_count: number
joint_parents_sha256: string
pelvis_joint_index: number
/**
 * 아직 텍스처가 없으면 null(기본 재질로 그린다)
 */
texture_url: (string | null)
/**
 * 표면 출처 지도(avatar_asset surface_source.mask_uri 의 내려받기 경로). 텍셀 값 2 = OBSERVED, 1 = INTERPOLATED, 0 = UNOBSERVED, 얼굴 영역 텍셀은 128 을 더한다(130 = 얼굴 관측, 128 = 얼굴 미관측, 129 불가). 무손실 8비트 단일 채널 PNG, 텍스처와 같은 UV·같은 해상도(docs/design/avatar-pose-stream.md '표면 출처 지도'). 텍스처가 있으면 필수, 없으면 null
 */
surface_source_url: (string | null)
surface_ratios: {
OBSERVED: number
INTERPOLATED: number
UNOBSERVED: number
}
/**
 * avatar_asset surface_source.face_ratios 그대로(얼굴 영역 관측·미관측, 보간 없음)
 */
face_ratios: {
OBSERVED: number
UNOBSERVED: number
}
/**
 * avatar_asset face_policy 그대로
 */
face_policy: ("OBSERVED" | "BLURRED" | "EXCLUDED")
})
/**
 * EC2 → 관제 화면, STOMP /topic/watch (확장 부록 C.6, FR-46, 12.4). EC2 가 BOUND 워치에 보낸 watch_alert 에 VIBRATED watch_ack 가 ack_within_ms 안에 오지 않았거나(NO_ACK) 보내지 못했을 때(SEND_FAILED) 관리자에게 알리는 격상이다. 한 알림에 한 번만 보낸다. 워치 ACK·격상은 운영자 확인(3.2)이 아니며 이벤트 상태를 바꾸지 않는다. CRITICAL·HIGH 이벤트의 현장 경보는 Tier 0·노트북이 이미 울리고, EC2 가 CAUTION 을 현장 경보로 올리는 경로는 없다(S15P31A101-338 설계 server-watch-alert.md 남은 일). 사람 이름을 싣지 않는다(익명 World ID·기기 ID, 11.4-5). 1.0.0 신설(S15P31A101-338). 1.1.0(마이너, S15P31A101-475): 관리자·반장이 직접 보낸 수동 알림(POST /api/watch-alerts)의 격상도 같은 메시지로 온다 — origin(EVENT·MANUAL, 없으면 EVENT)을 더하고, MANUAL 은 위험 이벤트가 없어 event_id 가 그 알림만의 ID 이고 event_sequence 1, world_id 는 배정이 없으면 null 이다. EVENT 는 전과 같이 world_id 가 있어야 한다.
 */
export type WatchEscalationMessage = (Envelope & {
msg_type?: "watch_escalation"
payload: WatchEscalationPayload
})
/**
 * EC2(source_id ec2) → 관제 화면 STOMP /topic/ppe 와 처음 상태 REST GET /api/ppe/current. EC2 가 I1 ppe_state 로 갱신한 사람별 화면용 현재 상태(ppe_current_state)를 한 장의 스냅샷으로 싣는다(명세 8.10, 12.3, 12.4, 13.3). 스냅샷이라 이번 메시지에 없는 사람은 '지금 보일 PPE 상태 없음'이다(이전 메시지 값을 이어 쓰지 않는다). 근거 프레임 키·local ID·모델 판 같은 내부 값은 싣지 않는다(사람·장비 객체는 닫힘. payload 최상위는 수신 측이 모르는 필드를 무시하는 계약 규칙대로 열어 둔다). 뷰어는 같은 world_id·identity_revision 의 world_state 트랙에만 붙이고, expires_at_ms 가 지나거나 EC2 연결이 끊기면 UNKNOWN 으로 보인다. PPE 표시는 경보가 아니다(경보는 R9 이벤트, 7.3). 1.0.0 신설(S15P31A101-531). 1.1.0 필드 추가(마이너, S15P31A101-634): 선택 last_received_at_ms(이 Tier 0 의 ppe_state 를 EC2 가 마지막으로 받은 시각, 사람이 0명인 메시지도 센다) — 관제 화면이 'PPE 상태 수신 없음'(PPE 프로세스가 안 떴거나 멈춤)을 안내하는 근거다. 이전 EC2 는 싣지 않는다.
 */
export type PpeViewMessage = (Envelope & {
msg_type?: "ppe_view"
payload: PpeViewPayload
})
/**
 * 장비 하나(안전모 또는 조끼)의 화면용 상태. state 는 EC2 가 snapshot_at_ms 기준으로 만료를 반영한 값이고 reported_state 는 PPE 프로세스가 보낸 값이다. 만료됐으면 state UNKNOWN·reason EVIDENCE_EXPIRED 다. 착용·미착용 표시는 보낸 값과 같을 때만 가능하다(EC2 가 상태를 지어내지 않는다)
 */
export type ItemView = ({
[k: string]: unknown
} & {
/**
 * 화면에 보일 상태(명세 6장 PPE 상태)
 */
state: ("WORN" | "NOT_WORN" | "UNKNOWN")
/**
 * ppe_state item_state.state 그대로
 */
reported_state: ("WORN" | "NOT_WORN" | "UNKNOWN")
/**
 * ppe_state item_state.reason 그대로. 만료를 반영했으면 EVIDENCE_EXPIRED. 읽는 쪽은 모르는 코드를 표시만 한다
 */
reason: string
/**
 * ppe_state 값 그대로(마지막 근거 촬영 시각, Tier 0 시계). 화면은 상태 옆에 이 시각을 보인다. 근거가 없으면 null
 */
last_evidence_at_ms: (number | null)
/**
 * ppe_state 값 그대로(Tier 0 시계). 뷰어는 다음 스냅샷 전이라도 이 시각이 지나면 UNKNOWN 으로 보인다. 근거가 없으면 null
 */
expires_at_ms: (number | null)
})

export interface FrontContracts {
world_state?: WorldStateMessage
risk_event?: RiskEventMessage
viewer_health?: ViewerHealthMessage
avatar_frame?: AvatarFrameMessage
watch_escalation?: WatchEscalationMessage
ppe_view?: PpeViewMessage
}
/**
 * I0의 영상 프레임(바이너리)을 제외한 모든 구간 메시지의 봉투 (명세 12.1). 수신 측은 모르는 필드를 무시한다.
 */
export interface Envelope {
schema_version: string
msg_type: string
/**
 * 중복 수신 제거용
 */
msg_id: string
/**
 * UTC epoch 밀리초
 */
sent_at: number
/**
 * 실제 송신 주체 (tier0-01, laptop-01, ec2). Tier 0가 보내는 메시지의 source_id는 이벤트의 gateway_id와 같다.
 */
source_id: string
payload: {

}
}
export interface WorldStatePayload {
/**
 * UTC epoch 밀리초
 */
t_latest_global: number
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
calibration_version: string
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
scene_version: string
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
config_version?: string
input_provenance?: InputProvenance
tracks: WorldTrack[]
}
/**
 * 이 World 상태를 만든 입력의 출처 (명세 20.4 규칙 2·3, 관측과 추정 구분). 선택 필드. SIM·DATASET_GT 입력이면 is_upper_bound 가 true 이고, 그 결과는 제품 성능이나 실제 관측으로 쓰지 않는다
 */
export interface InputProvenance {
frames: {
/**
 * FrameSource 출처 (명세 20.4)
 */
source: ("LIVE" | "FILE" | "SIM" | "DATASET")
/**
 * 예: cmu_panoptic/160422_ultimatum1, scenario/2026-10-20_a
 */
dataset_id?: string
dataset_hash?: string
camera_ids?: string[]
}
/**
 * 보정 입력. 이미지만 넣어 모델이 카메라를 스스로 추정하는 Run에는 생략한다
 */
calibration?: {
/**
 * CalibrationProvider 출처 (명세 20.4). G1_AUTO = 무마커 자동 보정(4.3), MODEL_ESTIMATE = 이전 Run에서 모델(MapAnything 등)이 추정한 카메라를 입력으로 다시 쓴 경우. 2.0.0 의미 변경(메이저): v1.3 에서 쓰지 않는 마커 보정·평면도 대응점 출처 값을 뺐다(명세 4.3 대체 경로, 16장)
 */
source: ("G1_AUTO" | "DATASET_GT" | "SIM" | "MODEL_ESTIMATE")
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
calibration_version: string
}
/**
 * 사람 관련 결과물에서 필수
 */
tracks?: {
/**
 * WorldTrackProvider 출처 (명세 20.4)
 */
source: ("TIER0_LOG" | "TIER0_LIVE" | "DATASET_GT" | "SIM")
provider_version: string
}
/**
 * 입력 중 하나라도 DATASET_GT 또는 SIM이면 true. true인 결과의 지표는 '입력이 완벽할 때의 상한'이며 제품 성능으로 주장하지 않는다.
 */
is_upper_bound: boolean
}
/**
 * 관절 배열은 모두 같은 길이, joint_layout 순서. 2대 미만에서 보인 관절은 null (지어내지 않음).
 */
export interface Skeleton {
/**
 * COCO17 순서: nose, l_eye, r_eye, l_ear, r_ear, l_shoulder, r_shoulder, l_elbow, r_elbow, l_wrist, r_wrist, l_hip, r_hip, l_knee, r_knee, l_ankle, r_ankle
 */
joint_layout: ("COCO17" | "HALPE26" | "MHR70" | "MHR_NATIVE")
joints: (WorldXyz | null)[]
visible: boolean[]
validity: ("VALID" | "UNCERTAIN" | "UNAVAILABLE")[]
/**
 * Items: observed=Tier 0 삼각측량, inferred=Tier 1 HMR
 */
joint_source: ("observed" | "inferred")[]
}
/**
 * 규칙의 수치 근거. 단위는 키 이름에 붙인다 (예: edge_distance_m, height_diff_m)
 */
export interface RuleMetrics {
[k: string]: number
}
/**
 * 운영자 종료 해소(명세 6.4, S15P31A101-200). 관측으로 해소를 확인한 것이 아니라 관제 화면 관리자가 누가·왜를 남기고 닫았다. 이 값이 있는 해소는 검증 상태 VERIFIED·판정 근거(evidence_ref)를 요구하지 않는다. 값은 I1 event_close.close 그대로다
 */
export interface OperatorResolution {
kind: "OPERATOR_CLOSED"
/**
 * event_close 의 멱등 키
 */
close_id: string
channel: "CONTROL_ROOM"
actor_role: "ADMIN"
/**
 * 관리자 계정 ID. 사람 이름을 넣지 않는다 (명세 11.4-5)
 */
actor_id: string
/**
 * UTC epoch 밀리초
 */
requested_at: number
reason: string
}
/**
 * 병합 흡수 마감(명세 5.2 ID 교정·6.4, S15P31A101-657, risk_event_transition 2.3.0). 관측 해소가 아니라 World ID 병합으로 같은 사람의 같은 규칙·구역 위험 이벤트가 둘이 되어, 흡수된 쪽(merged_world_id 로 열린 이벤트)을 남는 이벤트(survivor_event_id)에 귀속하고 닫았다. 위험은 남는 이벤트가 그대로 이어 간다(자동 해소 아님). 이 값이 있는 해소는 검증 상태 VERIFIED·판정 근거(evidence_ref)를 요구하지 않는다. 화면은 이 카드를 남는 이벤트에 합쳐 보이면 된다
 */
export interface IdentityMergeResolution {
kind: "IDENTITY_MERGED"
/**
 * UUIDv7 (시간 순서, 재시작·여러 현장에서도 충돌 없음). event_id 에 쓴다 (명세 3.2 식별자 규칙)
 */
survivor_event_id: string
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
survivor_world_id: string
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
merged_world_id: string
}
/**
 * EC2 마감(S15P31A101-722, I2 risk_event 2.5.0. I1 risk_event_transition 에는 없다). 관측 해소도 운영자 종료도 아니다: 그 이벤트를 들고 있던 Tier 0 가 사라져(작업 종료·GPU 세션 종료) 또는 살아 있는 Tier 0 의 재동기화 스냅샷에 그 이벤트가 없어 해소 전이가 다시는 오지 않을 이벤트를 EC2 가 닫았다는 기록이다. 위험이 사라졌다는 뜻이 아니며 검증 상태를 바꾸지 않는다(VERIFIED·판정 근거 불요). EC2 는 Tier 0 가 그 이벤트의 전이를 다시 보내면(같은 Tier 0 가 돌아옴) Tier 0 쪽을 따른다. 화면은 관측 해소와 구분하고 「최근 해소」에 넣지 않는다
 */
export interface ServerCloseResolution {
/**
 * WORK_ENDED: 작업 종료 때 그 Tier 0 가 연결도 열린 GPU 세션도 없음. SESSION_ENDED: 그 Tier 0 의 GPU 세션이 끝남(종료 보고·밀림·무응답·관리자 정지 등). NOT_IN_SNAPSHOT: 살아 있는 Tier 0 의 event_state_snapshot 활성 목록에 없음(이전 Pod·이전 저널의 이벤트)
 */
kind: ("WORK_ENDED" | "SESSION_ENDED" | "NOT_IN_SNAPSHOT")
/**
 * EC2 마감 기록(risk_event_server_close) ID
 */
close_id: string
/**
 * UTC epoch 밀리초
 */
closed_at: number
/**
 * 사람이 읽는 마감 사유(한국어 한 줄)
 */
reason: string
/**
 * 마감을 일으킨 것: WORK_ENDED 는 work_unit ID, SESSION_ENDED 는 GPU 세션 ID, NOT_IN_SNAPSHOT 은 스냅샷을 보낸 gateway_id. 모르면 null
 */
trigger_ref: (string | null)
/**
 * 닫을 때 EC2 가 반영해 둔 마지막 Tier 0 event_sequence. 모르면 null
 */
last_event_sequence: (number | null)
}
/**
 * 운영자 상향(명세 5.4, 6.4, FR-116, S15P31A101-206). VLM 상향 의견(proposed_severity)을 관제 화면 관리자가 승인해 LIVE 이벤트 등급을 올린 기록이다. 판정이 아니므로 전이의 evidence_ref 는 직전 판정 근거(모르면 null)다. 상향만 가능하고 하향·해소·끄기는 표현할 수 없다. 거절은 EC2 에만 기록하고 Tier 0 로 보내지 않는다. 값은 I1 event_escalate.escalation 그대로다
 */
export interface OperatorEscalation {
/**
 * EC2 가 발급하는 멱등 키. 같은 값을 다시 보내면 Tier 0 는 다시 기록하지 않는다
 */
escalation_id: string
/**
 * 상향 근거. 지금은 VLM 상향 의견 승인뿐이다
 */
basis: "VLM_PROPOSAL"
/**
 * 승인한 상향 의견을 낸 vlm_rationale 작업의 job_id (EC2 vlm_assessment 와 연결)
 */
assessment_job_id: string
/**
 * 올릴 등급. 승인한 proposed_severity 와 같다. Tier 0 는 지금 등급보다 높을 때만 받는다(같거나 낮으면 거부)
 */
target_severity: ("CRITICAL" | "HIGH" | "CAUTION")
channel: "CONTROL_ROOM"
actor_role: "ADMIN"
/**
 * 관리자 계정 ID. 사람 이름을 넣지 않는다 (명세 11.4-5)
 */
actor_id: string
/**
 * UTC epoch 밀리초
 */
requested_at: number
/**
 * 관리자 메모(선택)
 */
note?: string
}
export interface Scene {
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
scene_version: string
calibration_version: (string | null)
verification: ("VERIFIED" | "DIMMED" | "MISMATCH")
regeneration_required: boolean
reason: ("SAME_CALIBRATION" | "SMALL_CHANGE" | "LARGE_CHANGE" | "DIFFERENT_WORLD" | "UNKNOWN")
max_center_delta_m: (number | null)
max_rotation_delta_rad: (number | null)
/**
 * 선택(v7.28.0, S15P31A101-602). 카메라별 중심 이동·회전 변화(생성 보정 대비). EC2 GET /api/scenes/current 의 compatibility 만 싣고 viewer_health 에는 싣지 않는다. 두 보정의 카메라 자세를 실제로 비교했을 때만 배열(카메라 ID 순, max_* 는 이 값들의 최대)이고, 같은 보정(SAME_CALIBRATION, 모두 0)·다른 World·자세 미상이면 null 이다.
 * 
 * @maxItems 64
 */
cameras?: (CameraDelta[] | null)
}
export interface CameraDelta {
camera_id: string
/**
 * 카메라 중심 C = -R^T t 사이 거리, 미터
 */
center_delta_m: number
/**
 * 두 회전 사이 각도 acos((tr(R_a R_b^T) - 1) / 2), 라디안
 */
rotation_delta_rad: number
}
export interface AvatarFramePayload {
/**
 * 포즈 묶음의 입력 출처를 그대로 싣는다. 출처가 다른 묶음은 다른 메시지로 보낸다
 */
input_provenance: (InputProvenance1 & {
[k: string]: unknown
})
/**
 * 이번에 갱신된 사람들(최대 64명, 메시지 바이트 상한은 설계 문서). 한 메시지에 같은 world_id 는 하나(계약 시험)
 * 
 * @minItems 1
 * @maxItems 64
 */
avatars: [Avatar, ...(Avatar)[]]
}
/**
 * 결과물을 만든 입력의 출처 (명세 20.4 입력 대체 계약 규칙 2·3)
 */
export interface InputProvenance1 {
frames: {
/**
 * FrameSource 출처 (명세 20.4)
 */
source: ("LIVE" | "FILE" | "SIM" | "DATASET")
/**
 * 예: cmu_panoptic/160422_ultimatum1, scenario/2026-10-20_a
 */
dataset_id?: string
dataset_hash?: string
camera_ids?: string[]
}
/**
 * 보정 입력. 이미지만 넣어 모델이 카메라를 스스로 추정하는 Run에는 생략한다
 */
calibration?: {
/**
 * CalibrationProvider 출처 (명세 20.4). G1_AUTO = 무마커 자동 보정(4.3), MODEL_ESTIMATE = 이전 Run에서 모델(MapAnything 등)이 추정한 카메라를 입력으로 다시 쓴 경우. 2.0.0 의미 변경(메이저): v1.3 에서 쓰지 않는 마커 보정·평면도 대응점 출처 값을 뺐다(명세 4.3 대체 경로, 16장)
 */
source: ("G1_AUTO" | "DATASET_GT" | "SIM" | "MODEL_ESTIMATE")
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
calibration_version: string
}
/**
 * 사람 관련 결과물에서 필수
 */
tracks?: {
/**
 * WorldTrackProvider 출처 (명세 20.4)
 */
source: ("TIER0_LOG" | "TIER0_LIVE" | "DATASET_GT" | "SIM")
provider_version: string
}
/**
 * 입력 중 하나라도 DATASET_GT 또는 SIM이면 true. true인 결과의 지표는 '입력이 완벽할 때의 상한'이며 제품 성능으로 주장하지 않는다.
 */
is_upper_bound: boolean
}
/**
 * 한 사람의 최신 포즈와 그 포즈가 가리키는 자산. 위치 필드가 끼어들지 않도록 닫는다(Tier 0 정본)
 */
export interface Avatar {
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
world_id: string
/**
 * avatar_pose_batch 값 그대로. 뷰어가 그리는 world_state 트랙 값과 다르면 캡슐로 그린다
 */
identity_revision: number
/**
 * UTC epoch 밀리초
 */
capture_time_ms: number
/**
 * UTC epoch 밀리초
 */
received_at_ms: number
/**
 * calibration_version, scene_version, config_version 등 (예: cal-7)
 */
calibration_version: string
appearance_version: number
joint_source: "inferred"
pose: MhrPose
/**
 * appearance_version 의 자산. EC2 가 그 버전의 avatar_asset 을 아직 받지 못했으면 null(뷰어는 캡슐로 그린다)
 */
asset: (ViewerAsset | null)
}
/**
 * MHR 리깅 메시의 포즈 하나 (EXP-02 아바타 스트림, docs/design/avatar-pose-stream.md). 위치는 싣지 않는다: root 위치·접지는 Tier 0 world_state 가 정본이다(명세 5.2, 20.4 아바타 구동). 모든 회전은 HMR 추정(inferred)이고 표시에만 쓰며 위험 판정에 넣지 않는다
 */
export interface MhrPose {
root_rotation: AxisAngle
/**
 * 관절별 부모 기준(local) 회전. 인덱스 i = 자산 skeleton 의 관절 i(MHR 자산 관절 순서 = glTF skin.joints[i]), 길이 = avatar_asset skeleton.joint_count(계약 시험). 관절 0(MHR body_world, 바닥 원점)은 [0, 0, 0] 이고, MHR 이 몸 방향을 거는 관절 1(MHR root, pelvis)의 회전은 몸 전체 방향으로 root_rotation 에 옮기므로 관절 1 도 [0, 0, 0](계약 시험은 관절 0 만 확인). null = HMR 가 이 관절을 추정하지 않음(예: body 모드의 손가락), 뷰어는 그 관절의 기준(bind) 회전을 둔다. 지어내지 않는다
 * 
 * @minItems 1
 * @maxItems 1024
 */
joint_rotations: [(AxisAngle1 | null), ...((AxisAngle1 | null))[]]
}
export interface WatchEscalationPayload {
/**
 * EVENT: 위험 이벤트로 보낸 알림(-338). MANUAL: 관리자·반장이 POST /api/watch-alerts 로 직접 보낸 알림(-475). 없으면 EVENT 로 읽는다(1.0.0 수신 호환. 스키마 default 는 두지 않는다: 생성 Java 모델이 없는 필드를 채워 넣는다)
 */
origin?: ("EVENT" | "MANUAL")
/**
 * UUIDv7 (시간 순서, 재시작·여러 현장에서도 충돌 없음). event_id 에 쓴다 (명세 3.2 식별자 규칙)
 */
event_id: string
/**
 * 워치에 알린 이벤트 상태. MANUAL 은 1
 */
event_sequence: number
/**
 * 격상한 watch_alert 의 봉투 msg_id
 */
alert_msg_id: string
/**
 * 송신 주체 식별자 (tier0-01, laptop-01, ec2). Tier 0 인스턴스 식별자가 이벤트의 gateway_id 다 (명세 12.1)
 */
device_id: string
/**
 * 그 워치에 배정된 익명 World ID. MANUAL 은 배정이 없으면 null(EVENT 는 늘 있다, 아래 if/else)
 */
world_id: (string | null)
severity: ("CRITICAL" | "HIGH" | "CAUTION")
/**
 * NO_ACK: 기한(ack_within_ms) 안에 VIBRATED ACK 가 EC2 에 닿지 않음. SEND_FAILED: 워치로 보내지 못함(연결이 그 사이 끊김 등)
 */
reason: ("NO_ACK" | "SEND_FAILED")
/**
 * UTC epoch 밀리초
 */
sent_at: number
/**
 * UTC epoch 밀리초
 */
escalated_at: number
}
export interface PpeViewPayload {
/**
 * 이 상태를 보낸 Tier 0 연결의 source_id(I1 ppe_state 봉투 값, 예 tier0-01). Tier 0 마다 따로 보낸다
 */
tier0_source_id: string
/**
 * UTC epoch 밀리초
 */
snapshot_at_ms: number
/**
 * 1.1.0: EC2 가 이 Tier 0 의 ppe_state 를 마지막으로 받은 시각(EC2 시계). 사람이 0명인 메시지와 people 이 모두 버려진 메시지도 센다. 이 EC2 가 시작된 뒤 한 번도 받지 못했으면 null. 화면은 snapshot_at_ms 와의 차이로 수신 끊김을 안내한다. 경보·판정에는 쓰지 않는다
 */
last_received_at_ms?: (number | null)
/**
 * 이 Tier 0 의 사람별 현재 상태 중 촬영 시각이 snapshot_at_ms − 60초 이후인 것(최신 촬영 순, 최대 64명). 빈 배열은 보일 상태가 없다는 뜻이다. 한 메시지에 같은 world_id 는 하나(계약 시험)
 * 
 * @minItems 0
 * @maxItems 64
 */
people: PersonView[]
}
/**
 * 한 사람의 안전모·조끼 현재 상태. 위치·이미지 필드가 끼어들지 않도록 닫는다(위치·ID 정본은 /topic/world)
 */
export interface PersonView {
/**
 * 세션 단위 익명 World ID (예: w-0012)
 */
world_id: string
/**
 * ppe_state 값 그대로(판정에 쓴 Tier 0 트랙의 identity_revision). 뷰어가 그리는 world_state 트랙 값과 다르면 이 상태를 그 사람에게 붙이지 않는다
 */
identity_revision: number
/**
 * UTC epoch 밀리초
 */
capture_time_ms: number
/**
 * UTC epoch 밀리초
 */
received_at_ms: number
helmet: ItemView
vest: ItemView
}

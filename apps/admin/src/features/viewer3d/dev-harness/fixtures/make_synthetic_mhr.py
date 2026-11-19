"""Spatial 개발 화면용 합성 MHR 스키닝 GLB 를 만든다(S15P31A101-65).

실제 MHR 자산(SAM License)은 저장소에 없어서, 관절 127개·관절 0 바닥 원점·관절 1 pelvis 인 같은 구조의 합성 인체 리그를
만들고 AI -88 의 내보내기(simai_ai.hmr.gltf_export.build_skinned_glb)를 그대로 불러 .glb 로 쓴다.
실제 체형·관절 순서·손가락 위치와는 다르다(뷰어 적재·회전 적용·pelvis 정렬·폴백 시험용).

실행(저장소 루트): PYTHONPATH=ai/src python front/apps/admin/src/features/viewer3d/dev-harness/fixtures/make_synthetic_mhr.py [--dense]
--dense 는 실제 MHR 메시와 비슷한 크기(면을 13×13 으로 나눔, 정점 약 2.1만·삼각형 약 3.7만, 관절 근처는 부모 관절과 가중치를 섞음)의
synthetic-mhr-dense.glb 를 만든다. 여러 명 동시 표시 성능 시험용이다(-65).
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np

from simai_ai.hmr.gltf_export import build_skinned_glb
from simai_ai.hmr.rig import CM_TO_M, MhrRig, PersonRig, joint_parents_sha256

DENSE = "--dense" in sys.argv
OUT = Path(__file__).with_name("synthetic-mhr-dense.glb" if DENSE else "synthetic-mhr.glb")
GRID = 13 if DENSE else 1
BLEND_CM = 8.0  # dense: 관절 원점에서 이 거리 안의 정점은 부모 관절과 가중치를 나눈다
J = 127

# (이름, 부모, 부모 기준 이동 cm). 리그 좌표는 glTF Y-up, 사람은 +Z 를 본다.
BODY = [
    ("body_world", -1, (0.0, 0.0, 0.0)),
    ("root", 0, (0.0, 92.4, 0.0)),
    ("spine1", 1, (0.0, 10.0, 0.0)),
    ("spine2", 2, (0.0, 15.0, 0.0)),
    ("spine3", 3, (0.0, 15.0, 0.0)),
    ("neck", 4, (0.0, 13.0, 0.0)),
    ("head", 5, (0.0, 9.0, 0.0)),
    ("l_clavicle", 4, (7.0, 9.0, 0.0)),
    ("l_shoulder", 7, (11.0, 0.0, 0.0)),
    ("l_elbow", 8, (0.0, -28.0, 0.0)),
    ("l_wrist", 9, (0.0, -25.0, 0.0)),
    ("r_clavicle", 4, (-7.0, 9.0, 0.0)),
    ("r_shoulder", 11, (-11.0, 0.0, 0.0)),
    ("r_elbow", 12, (0.0, -28.0, 0.0)),
    ("r_wrist", 13, (0.0, -25.0, 0.0)),
    ("l_hip", 1, (9.0, -4.0, 0.0)),
    ("l_knee", 15, (0.0, -42.0, 0.0)),
    ("l_ankle", 16, (0.0, -41.0, 0.0)),
    ("l_toe", 17, (0.0, -5.0, 13.0)),
    ("r_hip", 1, (-9.0, -4.0, 0.0)),
    ("r_knee", 19, (0.0, -42.0, 0.0)),
    ("r_ankle", 20, (0.0, -41.0, 0.0)),
    ("r_toe", 21, (0.0, -5.0, 13.0)),
]
names = [b[0] for b in BODY]
parents = [b[1] for b in BODY]
offsets = [b[2] for b in BODY]
# 나머지 관절(가중치 없음). MHR 손가락 범위(43~64·79~100)처럼 손목 아래에 둔다.
for j in range(len(BODY), J):
    names.append(f"filler_{j}")
    parents.append(10 if j < 75 else 14)
    offsets.append((0.0, -1.0, 0.0))
parents_np = np.array(parents)
offsets_np = np.array(offsets, dtype=np.float64)

glob = np.zeros((J, 3))
for j in range(J):
    glob[j] = offsets_np[j] if parents[j] < 0 else glob[parents[j]] + offsets_np[j]

# (관절, 최소 cm, 최대 cm): 그 관절 하나에 가중치 1 로 붙는 상자.
def seg(j: int, a, b, half_x: float, half_z: float):
    a, b = np.asarray(a, float), np.asarray(b, float)
    lo, hi = np.minimum(a, b), np.maximum(a, b)
    return j, lo - [half_x, 0, half_z], hi + [half_x, 0, half_z]


P = glob
boxes = [
    seg(1, P[1] + [0, -8, 0], P[1] + [0, 9, 0], 15, 9),
    seg(2, P[2], P[3], 14, 9),
    seg(3, P[3], P[4], 16, 10),
    seg(4, P[4], P[4] + [0, 12, 0], 18, 10),
    seg(5, P[5], P[6], 5, 5),
    seg(6, P[6], P[6] + [0, 22, 0], 9, 10),
    seg(8, P[8], P[9], 4.5, 4.5),
    seg(9, P[9], P[10], 4, 4),
    seg(10, P[10], P[10] + [0, -9, 0], 3, 4),
    seg(12, P[12], P[13], 4.5, 4.5),
    seg(13, P[13], P[14], 4, 4),
    seg(14, P[14], P[14] + [0, -9, 0], 3, 4),
    seg(15, P[15], P[16], 7, 7),
    seg(16, P[16], P[17], 5.5, 5.5),
    seg(17, P[17] + [0, -5.4, -4], P[18] + [0, 2, 0], 5, 0),
    seg(19, P[19], P[20], 7, 7),
    seg(20, P[20], P[21], 5.5, 5.5),
    seg(21, P[21] + [0, -5.4, -4], P[22] + [0, 2, 0], 5, 0),
]

FACES = [  # (축, 부호)
    (0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1),
]
verts, faces, joints = [], [], []
weights_rows: list[tuple[list[int], list[float]]] = []
for joint, lo, hi in boxes:
    for axis, sign in FACES:
        u, v = [a for a in range(3) if a != axis]
        n = np.zeros(3)
        n[axis] = sign
        corner = lambda fu, fv: np.array(
            [
                (hi[a] if sign > 0 else lo[a]) if a == axis else (lo[a] + (hi[a] - lo[a]) * (fu if a == u else fv))
                for a in range(3)
            ]
        )
        flip = np.dot(np.cross(corner(1, 0) - corner(0, 0), corner(1, 1) - corner(0, 0)), n) < 0
        base = len(verts)
        if not DENSE:
            # 기본 fixture 는 처음 만든 순서 그대로 쓴다(바이트·sha256 이 시나리오 상수와 같아야 한다).
            quad = [corner(cu, cv) for cu, cv in ((0, 0), (1, 0), (1, 1), (0, 1))]
            if flip:
                quad = quad[::-1]
            verts += quad
            weights_rows += [([joint], [1.0])] * 4
            faces += [[base, base + 1, base + 2], [base, base + 2, base + 3]]
            continue
        for gv in range(GRID + 1):
            for gu in range(GRID + 1):
                q = corner(gu / GRID, gv / GRID)
                verts.append(q)
                parent = parents[joint]
                d = float(np.linalg.norm(q - glob[joint]))
                share = max(0.0, 0.5 - d / (2 * BLEND_CM)) if DENSE and parent > 0 else 0.0
                weights_rows.append(([joint, parent], [1.0 - share, share]) if share > 0 else ([joint], [1.0]))
        for gv in range(GRID):
            for gu in range(GRID):
                a = base + gv * (GRID + 1) + gu
                b, c, d4 = a + 1, a + GRID + 2, a + GRID + 1
                tri = [[a, b, c], [a, c, d4]]
                faces += [t[::-1] for t in tri] if flip else tri

V = len(verts)
skin_j = np.zeros((V, 4), dtype=np.int64)
skin_w = np.zeros((V, 4))
for i, (js, ws) in enumerate(weights_rows):
    skin_j[i, : len(js)] = js
    skin_w[i, : len(ws)] = ws
ident = np.tile([0.0, 0.0, 0.0, 1.0], (J, 1))
inv_bind = np.concatenate([-glob, ident, np.ones((J, 1))], axis=1)
rig = MhrRig(
    joint_names=tuple(names),
    parents=parents_np,
    joint_offsets_cm=offsets_np,
    joint_prerotations=ident,
    parameter_transform=np.zeros((J * 7, 249)),
    scaling_parameters=np.zeros(249, dtype=bool),
    inverse_bind_pose=inv_bind,
    base_shape_cm=np.array(verts),
    shape_vectors_cm=np.zeros((0, V, 3)),
    faces=np.array(faces),
    skin_joints=skin_j,
    skin_weights=skin_w,
    dropped_weight_max=0.0,
    asset_sha256="sha256:" + "0" * 64,
    rig_source="spatial synthetic humanoid (S15P31A101-65 dev fixture, not MHR)",
)
inv_m = np.tile(np.eye(4), (J, 1, 1))
inv_m[:, :3, 3] = -glob * CM_TO_M
person = PersonRig(
    rig=rig,
    rest_vertices_m=np.array(verts) * CM_TO_M,
    local_translations_m=offsets_np * CM_TO_M,
    local_rotations=ident,
    local_scales=np.ones(J),
    inverse_bind_matrices=inv_m,
)
glb = build_skinned_glb(person, include_uv=False, name="synthetic_mhr")
OUT.write_bytes(glb.data)
print(OUT.name, len(glb.data), glb.sha256, joint_parents_sha256(parents_np), glb.vertex_count, glb.face_count)
assert glb.sha256 == "sha256:" + hashlib.sha256(OUT.read_bytes()).hexdigest()

"""Procedural motion for the orange stick figure (pure Python, no Blender needed).

Everything is expressed in world units (1 unit ~ 1 m) on the XZ plane.
`pose(frame)` returns the full pose of the rig for one frame at 24 fps.
Feet are planted on the ground with world-space foot plants, so the IK legs never slide.
"""
import math
from bisect import bisect_right

FPS = 24
TS = 12                 # frames per step (one stride = 2 steps = 1 second)
T0 = 20                 # first step starts here (before: idle)
X0 = -3.3               # start x of the planted lead foot
FOOT_R = 0.05           # limb radius -> height of the foot control above the floor
HIP_REST = 0.95         # hip height in the rest pose
LEG = 0.90              # total leg length (thigh + shin)
STAND_HIPS = 0.88


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_out_back(x, c1=1.1):
    x = clamp(x)
    c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def make_pchip(xs, ys):
    """Monotone cubic interpolation: smooth speed, never overshoots, flat at both ends."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = bisect_right(xs, x) - 1
        t = (x - xs[i]) / h[i]
        h00 = 2 * t**3 - 3 * t**2 + 1
        h10 = t**3 - 2 * t**2 + t
        h01 = -2 * t**3 + 3 * t**2
        h11 = t**3 - t**2
        return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]

    return f


# ---- footfalls --------------------------------------------------------------
# plant k is landed at T(k); even k -> near (L) foot, odd k -> far (R) foot.
PLANTS = {-1: X0 - 0.14, 0: X0, 1: X0 + 0.30, 2: X0 + 0.80}
for _k in range(3, 8):
    PLANTS[_k] = X0 + 0.80 + 0.5 * (_k - 2)
PLANTS[8] = PLANTS[7] + 0.14
LAST_PLANT = 8


def T(k):
    return T0 + k * TS


_root_pts_t = [T0 - 8]
_root_pts_x = [X0 - 0.07]
for _k in range(0, 8):
    _root_pts_t.append(T(_k) + 0.6 * TS)
    _root_pts_x.append(PLANTS[_k])
_root_pts_t.append(T(LAST_PLANT) + 0.6 * TS + 10)
_root_pts_x.append((PLANTS[7] + PLANTS[8]) / 2)
ROOT_X = make_pchip(_root_pts_t, _root_pts_x)
END_WALK = _root_pts_t[-1]


def foot(parity, f):
    """World (x, z) of a foot control. parity 0 = near/L foot, 1 = far/R foot."""
    ks = sorted(k for k in PLANTS if k % 2 == parity)
    for i, k in enumerate(ks):
        if i + 1 == len(ks):
            return PLANTS[k], FOOT_R
        n = ks[i + 1]
        lift = T(k) + 1.2 * TS
        land = T(n)
        if f < lift:
            return PLANTS[k], FOOT_R
        if f < land:
            u = (f - lift) / (land - lift)
            s = u - math.sin(2 * math.pi * u) / (2 * math.pi)
            dist = PLANTS[n] - PLANTS[k]
            height = 0.06 + 0.10 * clamp(dist / 1.0)
            z = FOOT_R + height * math.sin(math.pi * u) ** 0.85
            return PLANTS[k] + dist * s, z
    return PLANTS[ks[-1]], FOOT_R


# ---- gestures ---------------------------------------------------------------
WAVE_UP = (END_WALK + 4, END_WALK + 20)       # raise the pencil hand
WAVE_HOLD_END = END_WALK + 62
WAVE_DOWN = (WAVE_HOLD_END, WAVE_HOLD_END + 14)
HOP_START = WAVE_DOWN[1] + 6                  # begin crouch
HOP_LAUNCH = HOP_START + 9
HOP_AIR = 17
HOP_LAND = HOP_LAUNCH + HOP_AIR
HOP_END = HOP_LAND + 16
HOP_H = 0.42
LAST_FRAME = int(HOP_END) + 10


def pose(f):
    f = float(f)
    rx = ROOT_X(f)
    v = ROOT_X(f + 0.5) - ROOT_X(f - 0.5)            # units / frame
    env = smooth(abs(v) / ((0.5 / TS) * 0.85))        # 0 standing .. 1 full walk

    # --- hop -----------------------------------------------------------------
    crouch = smooth((f - HOP_START) / 8) * (1 - smooth((f - HOP_LAUNCH + 1) / 3))
    land = smooth((f - HOP_LAND + 2) / 3) * (1 - smooth((f - HOP_LAND - 4) / 12))
    crouch_amt = 0.15 * crouch + 0.13 * land
    u = (f - HOP_LAUNCH) / HOP_AIR
    air = HOP_H * 4 * u * (1 - u) if 0 <= u <= 1 else 0.0
    airborne = 1.0 if 0 < u < 1 else 0.0

    # --- hips ----------------------------------------------------------------
    walk_base = STAND_HIPS - 0.10 * env
    bob = 0.03 * env * math.cos(2 * math.pi * (f - T0 - 0.6 * TS) / TS)
    breathe = 0.004 * math.sin(2 * math.pi * f / 48) * (1 - env)
    hips_z = walk_base + bob + breathe - crouch_amt + air

    # --- feet ----------------------------------------------------------------
    fl = foot(0, f)
    fr = foot(1, f)
    tuck = 0.22 * math.sin(math.pi * clamp(u)) * airborne
    fl = (fl[0] + 0.03 * airborne, fl[1] + 0.9 * air + tuck)
    fr = (fr[0] - 0.03 * airborne, fr[1] + 0.9 * air + tuck * 1.3)

    # --- arms (forward-positive angles in radians) -----------------------------
    swing_l = -1.7 * (fl[0] - rx)
    swing_r = -1.7 * (fr[0] - rx)
    walk_ang_l, walk_ang_r = swing_l * env, swing_r * env
    elbow_walk_l = 0.22 + 0.35 * env + 0.55 * max(0.0, swing_l * env)
    elbow_walk_r = 0.22 + 0.35 * env + 0.55 * max(0.0, swing_r * env)

    raise_t = ease_out_back((f - WAVE_UP[0]) / (WAVE_UP[1] - WAVE_UP[0]), 1.0)
    lower_t = smooth((f - WAVE_DOWN[0]) / (WAVE_DOWN[1] - WAVE_DOWN[0]))
    w = clamp(raise_t, 0, 1.12) * (1 - lower_t) if f >= WAVE_UP[0] else 0.0
    hold = smooth((f - WAVE_UP[1]) / 4) * (1 - smooth((f - WAVE_HOLD_END + 4) / 4))
    wave_osc = math.sin(2 * math.pi * (f - WAVE_UP[1]) / 16.0)
    if WAVE_UP[0] - 6 <= f < WAVE_UP[0] + 2:
        anticipate = math.sin(math.pi * clamp((f - WAVE_UP[0] + 6) / 8)) * 0.25
    else:
        anticipate = 0.0

    arm_l = walk_ang_l * (1 - w) + (1.45 + 0.05 * wave_osc * hold) * w - anticipate
    elbow_l = elbow_walk_l * (1 - w) + (1.15 + 0.50 * wave_osc * hold) * w

    # hop arms (both): swing back in the crouch, up in the air
    back = smooth((f - HOP_START) / 8) * (1 - smooth((f - HOP_LAUNCH + 2) / 3))
    up = smooth((f - HOP_LAUNCH + 2) / 6) * (1 - smooth((f - HOP_LAND - 1) / 12))
    hop_arm_l = -0.7 * back + 2.1 * up        # near arm reaches forward-up,
    hop_arm_r = -0.7 * back + 3.7 * up        # far arm reaches back-up: a V in side view
    hop_w = clamp(back + up)
    arm_l = arm_l * (1 - hop_w) + hop_arm_l * hop_w
    arm_r = walk_ang_r * (1 - hop_w) + hop_arm_r * hop_w
    elbow_l = elbow_l * (1 - hop_w) + (0.25 + 0.2 * up) * hop_w
    elbow_r = elbow_walk_r * (1 - hop_w) + (0.25 + 0.2 * up) * hop_w

    # --- torso / head ---------------------------------------------------------
    lean = 0.14 * env + 0.20 * crouch + 0.12 * land - 0.05 * w - 0.06 * up
    head = -0.4 * lean + 0.03 * math.sin(2 * math.pi * (f - T0) / TS) * env
    head += 0.07 * math.sin(2 * math.pi * (f - WAVE_UP[1]) / 16.0) * hold - 0.05 * w

    shadow_s = 1 - 0.35 * clamp(air / HOP_H)
    return {
        "root_x": rx,
        "hips_z": hips_z,
        "foot_l": fl,
        "foot_r": fr,
        "arm_l": arm_l,
        "elbow_l": elbow_l,
        "arm_r": arm_r,
        "elbow_r": elbow_r,
        "lean": lean,
        "head": head,
        "shadow_s": shadow_s,
    }


if __name__ == "__main__":
    worst = 0.0
    worst_f = 0
    for fr_i in range(1, LAST_FRAME + 1):
        p = pose(fr_i)
        for name in ("foot_l", "foot_r"):
            fx, fz = p[name]
            d = math.hypot(fx - p["root_x"], fz - p["hips_z"])
            if d > worst:
                worst, worst_f = d, fr_i
    print("end walk", END_WALK, "wave", WAVE_UP, WAVE_HOLD_END, "hop", HOP_START, HOP_LAUNCH, HOP_LAND, HOP_END)
    print("max hip->foot distance", round(worst, 3), "at frame", worst_f, "(leg length", LEG, ")")
    print("last frame", LAST_FRAME, "final root x", round(pose(LAST_FRAME)["root_x"], 3))

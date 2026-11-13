"""Build the orange stick figure, its rig and the walk -> wave -> hop animation in Blender.

Run inside Blender (e.g. through the Blender MCP `execute_code`) or headless:
    blender -b --python build.py
Needs motion.py next to this file. Writes stickman.blend next to it.
"""
import importlib.util
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else r"D:\movynta\designs\stickman"
spec = importlib.util.spec_from_file_location("stickman_motion", os.path.join(HERE, "motion.py"))
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)

# ------------------------------------------------------------------ clean scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.lights,
              bpy.data.materials, bpy.data.actions, bpy.data.collections):
    for item in list(block):
        block.remove(item)

scene = bpy.context.scene
coll = bpy.data.collections.new("Stickman")
scene.collection.children.link(coll)


def srgb(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_mat(name, rgb):
    m = bpy.data.materials.new(name)
    lin = tuple(srgb(c) for c in rgb)
    m.diffuse_color = (*lin, 1.0)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*lin, 1.0)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


MAT_ORANGE = make_mat("Orange", (1.0, 0.40, 0.0))
MAT_ORANGE_FAR = make_mat("OrangeFar", (0.80, 0.30, 0.0))
MAT_GRAY = make_mat("PencilGray", (0.57, 0.57, 0.57))
MAT_WHITE = make_mat("PencilWhite", (0.86, 0.86, 0.86))
MAT_DARK = make_mat("PencilLead", (0.25, 0.25, 0.28))
MAT_SHADOW = make_mat("Shadow", (0.88, 0.88, 0.90))
MAT_GROUND = make_mat("Ground", (0.80, 0.80, 0.82))

# ------------------------------------------------------------------ rig
NECK_Z = 1.42
HEAD_C = Vector((0.0, 0.0, 1.675))
HEAD_RX, HEAD_RZ, HEAD_TUBE = 0.25, 0.22, 0.065
LIMB_R = 0.06

BONES = {
    # name: (head, tail, parent, connect)
    "root": ((0, 0, 0), (0, 0, 0.15), None, False),
    "hips": ((0, 0, 0.95), (0, 0, 1.03), "root", False),
    "spine": ((0, 0, 0.95), (0, 0, NECK_Z), "hips", False),
    "head": ((0, 0, NECK_Z), (0, 0, 1.96), "spine", True),
    "thigh.L": ((0, -0.05, 0.95), (0.05, -0.05, 0.50), "hips", False),
    "shin.L": ((0.05, -0.05, 0.50), (0, -0.05, 0.05), "thigh.L", True),
    "thigh.R": ((0, 0.05, 0.95), (0.05, 0.05, 0.50), "hips", False),
    "shin.R": ((0.05, 0.05, 0.50), (0, 0.05, 0.05), "thigh.R", True),
    "upperarm.L": ((0, -0.07, 1.36), (0, -0.07, 1.06), "spine", False),
    "forearm.L": ((0, -0.07, 1.06), (0, -0.07, 0.76), "upperarm.L", True),
    "upperarm.R": ((0, 0.07, 1.36), (0, 0.07, 1.06), "spine", False),
    "forearm.R": ((0, 0.07, 1.06), (0, 0.07, 0.76), "upperarm.R", True),
    "foot.L": ((0, -0.05, 0.05), (0, -0.05, 0.15), "root", False),
    "foot.R": ((0, 0.05, 0.05), (0, 0.05, 0.15), "root", False),
    "knee_pole.L": ((0.9, -0.05, 0.55), (0.9, -0.05, 0.63), "root", False),
    "knee_pole.R": ((0.9, 0.05, 0.55), (0.9, 0.05, 0.63), "root", False),
}

arm_data = bpy.data.armatures.new("StickmanArmature")
arm_obj = bpy.data.objects.new("StickmanRig", arm_data)
coll.objects.link(arm_obj)
arm_data.display_type = "STICK"
arm_obj.show_in_front = True
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, (h, t, parent, conn) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(h), Vector(t)
for name, (h, t, parent, conn) in BONES.items():
    if parent:
        eb = arm_data.edit_bones[name]
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = conn
for name in ("thigh.L", "shin.L", "thigh.R", "shin.R"):
    # make the bone's local Z exactly world +Y, so 'lock IK X/Y' keeps the legs in the side plane
    arm_data.edit_bones[name].align_roll(Vector((0, 1, 0)))
bpy.ops.object.mode_set(mode="OBJECT")

# bone collections for a tidy animator UI
ctrl = arm_data.collections.new("Controls")
deform = arm_data.collections.new("Body")
for name in BONES:
    (ctrl if name in ("root", "hips", "foot.L", "foot.R", "knee_pole.L", "knee_pole.R") else deform).assign(
        arm_data.bones[name])

# ------------------------------------------------------------------ geometry helpers


def add_sphere(bm, p, r):
    m = Matrix.Translation(Vector(p))
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=r, matrix=m)
    except TypeError:
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, diameter=r, matrix=m)


def add_tube(bm, a, b, r, seg=24, r2=None):
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((a + b) / 2) @ rot
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length, matrix=m)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, diameter1=r,
                              diameter2=r if r2 is None else r2, depth=d.length, matrix=m)


def add_capsule(bm, a, b, r):
    add_tube(bm, a, b, r)
    add_sphere(bm, a, r)
    add_sphere(bm, b, r)


def add_head_ring(bm):
    su, sv = 56, 16
    rings = []
    for i in range(su):
        u = 2 * math.pi * i / su
        c = HEAD_C + Vector((HEAD_RX * math.cos(u), 0, HEAD_RZ * math.sin(u)))
        n = Vector((math.cos(u) / HEAD_RX, 0, math.sin(u) / HEAD_RZ)).normalized()
        ring = []
        for j in range(sv):
            v = 2 * math.pi * j / sv
            ring.append(bm.verts.new(c + n * (HEAD_TUBE * math.cos(v)) + Vector((0, 1, 0)) * (HEAD_TUBE * math.sin(v))))
        rings.append(ring)
    for i in range(su):
        for j in range(sv):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % sv], rings[(i + 1) % su][(j + 1) % sv], rings[(i + 1) % su][j]))


class MeshBuilder:
    """Builds one skinned mesh object: parts are rigidly weighted to one bone each."""

    def __init__(self, name, groups, materials):
        self.name, self.groups, self.materials = name, groups, materials
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()

    def part(self, group, fn, mat=0):
        bm = self.bm
        # bmesh ops weld/delete vertices and the pool reuses freed slots, so new elements are
        # found by identity, never by index range.
        old_v, old_f = set(bm.verts), set(bm.faces)
        fn(bm)
        gi = self.groups.index(group)
        for v in bm.verts:
            if v not in old_v:
                v[self.dl][gi] = 1.0
        for f in bm.faces:
            if f not in old_f:
                f.material_index = mat

    def finish(self, armature):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        for m in self.materials:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        for g in self.groups:
            ob.vertex_groups.new(name=g)
        ob.parent = armature
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = armature
        mod.use_vertex_groups = True
        return ob


def P(bone, which):  # head/tail of a bone as a Vector
    return Vector(BONES[bone][0 if which == "head" else 1])


near_groups = ["hips", "spine", "head", "thigh.L", "shin.L", "upperarm.L", "forearm.L"]
body = MeshBuilder("Stickman_Body", near_groups, [MAT_ORANGE])
body.part("hips", lambda bm: add_sphere(bm, P("hips", "head"), LIMB_R + 0.005))
body.part("spine", lambda bm: add_capsule(bm, P("spine", "head"), P("spine", "tail"), LIMB_R + 0.005))
body.part("head", add_head_ring)
for b in ("thigh.L", "shin.L", "upperarm.L", "forearm.L"):
    hand = b == "forearm.L"
    body.part(b, lambda bm, b=b, hand=hand: add_capsule(bm, P(b, "head"), P(b, "tail"), LIMB_R + (0.008 if hand else 0)))
body_obj = body.finish(arm_obj)

far_groups = ["thigh.R", "shin.R", "upperarm.R", "forearm.R"]
far = MeshBuilder("Stickman_FarLimbs", far_groups, [MAT_ORANGE_FAR])
for b in far_groups:
    hand = b == "forearm.R"
    far.part(b, lambda bm, b=b, hand=hand: add_capsule(bm, P(b, "head"), P(b, "tail"), LIMB_R + (0.008 if hand else 0)))
far_obj = far.finish(arm_obj)

# pencil in the near hand: tilted, tip down/forward, rigid to the forearm
hand_p = P("forearm.L", "tail")
tilt = 0.38
axis = Vector((math.sin(tilt), 0, -math.cos(tilt)))
top = hand_p - axis * 0.15
wood0 = hand_p + axis * 0.16
wood1 = hand_p + axis * 0.27
lead1 = hand_p + axis * 0.305
pencil = MeshBuilder("Stickman_Pencil", ["forearm.L"], [MAT_GRAY, MAT_WHITE, MAT_DARK])
pencil.part("forearm.L", lambda bm: add_tube(bm, top + axis * 0.035, wood0, 0.043, seg=6), 0)
pencil.part("forearm.L", lambda bm: add_tube(bm, top, top + axis * 0.035, 0.043, seg=6), 1)
pencil.part("forearm.L", lambda bm: add_tube(bm, wood0, wood1, 0.043, seg=6, r2=0.010), 1)
pencil.part("forearm.L", lambda bm: add_tube(bm, wood1, lead1, 0.010, seg=6, r2=0.003), 2)
pencil_obj = pencil.finish(arm_obj)

# shadow + ground line (static meshes, shadow is animated below)
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, radius=1.0, segments=40, matrix=Matrix.Rotation(math.pi / 2, 4, "X"))
sh_me = bpy.data.meshes.new("Shadow")
bm.to_mesh(sh_me)
bm.free()
sh_me.materials.append(MAT_SHADOW)
shadow = bpy.data.objects.new("Shadow", sh_me)
shadow.location = (0, 0.35, 0.0)
shadow.scale = (0.55, 1, 0.045)
coll.objects.link(shadow)

bm = bmesh.new()
vs = [bm.verts.new(p) for p in ((-9, 0.6, -0.012), (9, 0.6, -0.012), (9, 0.6, 0.012), (-9, 0.6, 0.012))]
bm.faces.new(vs)
gr_me = bpy.data.meshes.new("Ground")
bm.to_mesh(gr_me)
bm.free()
gr_me.materials.append(MAT_GROUND)
ground = bpy.data.objects.new("Ground", gr_me)
coll.objects.link(ground)

# ------------------------------------------------------------------ pose bones, IK
bpy.context.view_layer.objects.active = arm_obj
pb = arm_obj.pose.bones
for p in pb:
    p.rotation_mode = "XYZ"

ik_legs = {}
for side in ("L", "R"):
    ik = pb[f"shin.{side}"].constraints.new("IK")
    ik.target = arm_obj
    ik.subtarget = f"foot.{side}"
    ik.pole_target = arm_obj
    ik.pole_subtarget = f"knee_pole.{side}"
    ik.chain_count = 2
    ik.use_stretch = False
    ik_legs[side] = ik
for name in ("thigh.L", "thigh.R", "shin.L", "shin.R"):
    pb[name].lock_ik_x = True      # legs only bend in the side plane
    pb[name].lock_ik_y = True

# (the rest pose has a slightly forward knee: Blender's IK cannot start bending a perfectly straight chain)
# choose the pole angle that bends the knees forward (+X)
mid = int(motion.T(2) + 2)
best = None
for ang in (-90, 90, 0, 180):
    for side in ("L", "R"):
        ik_legs[side].pole_angle = math.radians(ang)
    f0 = motion.pose(mid)
    pb["root"].location = (f0["root_x"], 0, 0)
    pb["hips"].location = (0, f0["hips_z"] - motion.HIP_REST, 0)
    for side, key in (("L", "foot_l"), ("R", "foot_r")):
        pb[f"foot.{side}"].location = (f0[key][0] - f0["root_x"], f0[key][1] - 0.05, 0)
    bpy.context.view_layer.update()
    knee = arm_obj.matrix_world @ pb["shin.L"].head
    score = knee.x - f0["root_x"]
    print("pole angle", ang, "-> knee dx", round(score, 3))
    if best is None or score > best[0]:
        best = (score, ang)
for side in ("L", "R"):
    ik_legs[side].pole_angle = math.radians(best[1])
print("using pole angle", best[1])

# ------------------------------------------------------------------ keyframes
scene.render.fps = motion.FPS
scene.frame_start = 1
scene.frame_end = motion.LAST_FRAME
arm_obj.animation_data_create()
action = bpy.data.actions.new("Stickman_WalkWaveHop")
arm_obj.animation_data.action = action


def key(bone, path, index, frame, group):
    bone.keyframe_insert(data_path=path, index=index, frame=frame, group=group)


for f in range(1, motion.LAST_FRAME + 1):
    p = motion.pose(f)
    rx = p["root_x"]
    pb["root"].location = (rx, 0, 0)
    key(pb["root"], "location", 0, f, "root")
    pb["hips"].location = (0, p["hips_z"] - motion.HIP_REST, 0)
    key(pb["hips"], "location", 1, f, "hips")
    for side, k in (("L", "foot_l"), ("R", "foot_r")):
        b = pb[f"foot.{side}"]
        b.location = (p[k][0] - rx, p[k][1] - motion.FOOT_R, 0)
        key(b, "location", 0, f, f"foot.{side}")
        key(b, "location", 1, f, f"foot.{side}")
    rot = {"spine": -p["lean"], "head": -p["head"],
           "upperarm.L": -p["arm_l"], "forearm.L": -p["elbow_l"],
           "upperarm.R": -p["arm_r"], "forearm.R": -p["elbow_r"]}
    for name, val in rot.items():
        pb[name].rotation_euler = (0, 0, val)
        key(pb[name], "rotation_euler", 2, f, name)
    # shadow follows the character and shrinks while he is in the air
    shadow.location.x = rx
    s = p["shadow_s"]
    shadow.scale = (0.55 * s, 1, 0.045 * s)
    shadow.keyframe_insert("location", index=0, frame=f)
    shadow.keyframe_insert("scale", frame=f)

# ------------------------------------------------------------------ camera / render
cam_data = bpy.data.cameras.new("Camera")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 7.4
cam = bpy.data.objects.new("Camera", cam_data)
cam.location = (0.0, -10.0, 1.35)
cam.rotation_euler = (math.pi / 2, 0, 0)
coll.objects.link(cam)
scene.camera = cam

scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light = "FLAT"
sh.color_type = "MATERIAL"
sh.show_object_outline = False
sh.show_cavity = False
sh.show_shadows = False
sh.show_specular_highlight = False
scene.display.render_aa = "16"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
scene.world = world
world.color = (1.0, 1.0, 1.0)
world.use_nodes = False

scene.frame_set(1)
out = os.path.join(HERE, "stickman.blend")
bpy.ops.wm.save_as_mainfile(filepath=out)
print("saved", out, "frames", scene.frame_end)

# TellyMote — 30s 3D motion graphics. Blender 5.2, Workbench, 1920x1080 @ 24 fps.
# Real 3D geometry + the real app screenshots as textured panels. No AI footage.
#
#   blender.exe -b -P tellymote_mg.py                 full 720-frame animation
#   MG_MODE=stills blender.exe -b -P tellymote_mg.py  one still per scene (checks)

import bpy
import math
import os
import time

MODE = os.environ.get("MG_MODE", "anim")
ROOT = r"C:\Users\natsa\OneDrive\Documents\hacker\tellymote"
OUT = os.path.join(os.path.expanduser("~"), "Videos", "opencode-gen", "tellymote-mg")
os.makedirs(OUT, exist_ok=True)

FPS, END = 24, 720
ACCENT = (0.878, 0.678, 0.388)
INK = (0.906, 0.914, 0.933)
MUTED = (0.62, 0.65, 0.70)
BG = (0.030, 0.033, 0.042)
SURFACE = (0.075, 0.083, 0.100)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, END
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(OUT, "f_")
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = 0.55

sh = scene.display.shading
sh.light = "STUDIO"
sh.studio_light = "studio.sl"
sh.studiolight_intensity = 0.85
sh.use_scene_lights = True
sh.use_scene_lights_render = True
sh.color_type = "TEXTURE"
sh.show_shadows = True
sh.shadow_intensity = 0.28
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.curvature_ridge_factor = 1.6
sh.curvature_valley_factor = 1.15
sh.show_specular_highlight = True
sh.show_object_outline = False
sh.use_dof = True
scene.display.render_aa = "32"


# ------------------------------------------------------------------ materials
def solid_image(name, rgb):
    img = bpy.data.images.new(name, width=8, height=8, alpha=True)
    img.pixels = [rgb[0], rgb[1], rgb[2], 1.0] * 64
    img.pack()
    return img


def tex_mat(name, image, flat=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Closest" if flat else "Linear"
    node.extension = "EXTEND"
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(node.outputs["Color"], out.inputs["Surface"])
    m.diffuse_color = (1, 1, 1, 1)
    return m


def flat(name, rgb):
    return tex_mat(name, solid_image(f"img_{name}", rgb))


M_ACCENT = flat("accent", ACCENT)
M_INK = flat("ink", INK)
M_MUTED = flat("muted", MUTED)
M_BG = flat("bg", BG)
M_SURFACE = flat("surface", SURFACE)
M_CARD = flat("card", (0.105, 0.115, 0.135))


# ------------------------------------------------------------------ helpers
def link(obj):
    scene.collection.objects.link(obj)
    return obj


def bevel(obj, width=0.02, segments=4):
    mod = obj.modifiers.new("bev", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return obj


def cube(name, size, loc, material, bev=0.03, scale=None):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)
    o = bpy.context.active_object
    o.name = name
    if scale:
        o.scale = scale
    o.data.materials.append(material)
    if bev:
        bevel(o, bev, 4)
    return o


def quad(name, w, h, loc, material):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=(math.radians(90), 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, h, 1)
    o.data.materials.append(material)
    return o


def text(name, body, size, loc, material, extrude=0.035, align="CENTER"):
    bpy.ops.object.text_add(location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.body = body
    o.data.align_x = align
    o.data.align_y = "CENTER"
    o.data.size = size
    o.data.extrude = extrude
    o.data.bevel_depth = 0.005
    o.data.bevel_resolution = 2
    o.data.space_character = 1.03
    try:
        o.data.font = bpy.data.fonts.load(r"C:\Windows\Fonts\bahnschrift.ttf")
    except Exception as exc:
        print("font:", exc)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.data.materials.append(material)
    return o


def iter_fcurves(obj):
    ad = obj.animation_data
    if not ad or not ad.action:
        return []
    act = ad.action
    out = []
    if hasattr(act, "fcurves"):
        try:
            out.extend(list(act.fcurves))
        except Exception:
            pass
    for layer in getattr(act, "layers", []):
        for strip in getattr(layer, "strips", []):
            for cb in getattr(strip, "channelbags", []):
                out.extend(list(cb.fcurves))
    return out


def smooth(o, path, mode="BEZIER"):
    for fc in iter_fcurves(o):
        if fc.data_path == path:
            for kp in fc.keyframe_points:
                kp.interpolation = mode
                kp.easing = "EASE_IN_OUT"


def key_loc(o, pairs):
    for f, v in pairs:
        o.location = v
        o.keyframe_insert("location", frame=f)
    smooth(o, "location")


def key_scale(o, pairs):
    for f, v in pairs:
        o.scale = (v, v, v) if isinstance(v, (int, float)) else v
        o.keyframe_insert("scale", frame=f)
    smooth(o, "scale")


def key_rot(o, pairs):
    for f, v in pairs:
        o.rotation_euler = v
        o.keyframe_insert("rotation_euler", frame=f)
    smooth(o, "rotation_euler")


def visible(objs, start, end):
    """Workbench renders the viewport state, so hide_viewport is the switch that matters.
    Both are keyed so viewport previews and any future EEVEE/Cycles pass agree."""
    for o in objs:
        for prop in ("hide_render", "hide_viewport"):
            setattr(o, prop, True)
            o.keyframe_insert(prop, frame=0)
            setattr(o, prop, False)
            o.keyframe_insert(prop, frame=max(1, start))
            setattr(o, prop, True)
            o.keyframe_insert(prop, frame=end + 1)
            smooth(o, prop, "CONSTANT")


# ------------------------------------------------------------------ stage
quad("backdrop", 90, 50, (0, 8.0, 0), M_BG)

# ------------------------------------------------------------------ camera
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = link(bpy.data.objects.new("cam", cam_data))
cam.rotation_euler = (math.radians(88), 0, 0)
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = 4.0
scene.camera = cam


def shot(frame, y, z, lens=50, focus=None):
    cam.location = (0, y, z)
    cam.keyframe_insert("location", frame=frame)
    cam.data.lens = lens
    cam.data.keyframe_insert("lens", frame=frame)
    cam.data.dof.focus_distance = focus if focus is not None else abs(y)
    cam.data.keyframe_insert("dof.focus_distance", frame=frame)


# lights
key = link(bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA")))
key.data.energy = 1400
key.data.size = 8
key.location = (5, -7, 7)
key.rotation_euler = (math.radians(48), 0, math.radians(30))

rim = link(bpy.data.objects.new("rim", bpy.data.lights.new("rim", "AREA")))
rim.data.energy = 700
rim.data.size = 6
rim.location = (-6, -3, 3)
rim.rotation_euler = (math.radians(72), 0, math.radians(-52))

# ------------------------------------------------------------------ transition wipe (child of camera)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
wipe = bpy.context.active_object
wipe.name = "wipe"
wipe.scale = (0.35, 4.0, 1)
wipe.data.materials.append(M_ACCENT)
wipe.parent = cam
wipe.location = (0, 0, -1.0)

wipe.hide_render = True
wipe.hide_viewport = True
wipe.keyframe_insert("hide_render", frame=0)
wipe.keyframe_insert("hide_viewport", frame=0)


def wipe_at(frame):
    wipe.hide_render = False
    wipe.hide_viewport = False
    wipe.keyframe_insert("hide_render", frame=frame - 3)
    wipe.keyframe_insert("hide_viewport", frame=frame - 3)
    wipe.keyframe_insert("hide_render", frame=frame + 3)
    wipe.keyframe_insert("hide_viewport", frame=frame + 3)
    wipe.hide_render = True
    wipe.hide_viewport = True
    wipe.keyframe_insert("hide_render", frame=frame + 4)
    wipe.keyframe_insert("hide_viewport", frame=frame + 4)
    for f, x in ((frame - 3, -3.2), (frame + 3, 3.2)):
        wipe.location = (x, 0, -1.0)
        wipe.keyframe_insert("location", frame=f)


if os.environ.get("MG_NOWIPE") != "1":
    for cut_frame in (120, 240, 360, 480, 600):
        wipe_at(cut_frame)
smooth(wipe, "hide_render", "CONSTANT")
smooth(wipe, "hide_viewport", "CONSTANT")
for fc in iter_fcurves(wipe):
    if fc.data_path == "location":
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

# ------------------------------------------------------------------ SCENE 1: mark + wordmark (1-120)
mark = cube("mark", 1.15, (0, 0, 0.78), M_ACCENT, bev=0.2)
mark_t = text("mark_t", "T", 0.68, (0, -0.62, 0.74), M_BG, extrude=0.02)
word = text("word", "TellyMote", 0.8, (0, 0, -0.55), M_INK, extrude=0.04)
tagline = text("tagline", "LOCAL NETWORK  ·  NO ACCOUNT  ·  NO CLOUD", 0.14, (0, 0, -1.22), M_MUTED, extrude=0.004)

key_scale(mark, [(1, 0.001), (18, 1.05), (26, 1.0)])
key_rot(mark, [(1, (0, math.radians(-72), math.radians(-16))), (30, (0, 0, 0))])
key_loc(mark, [(1, (0, 0.6, 0.95)), (26, (0, 0, 0.78))])
key_scale(mark_t, [(10, 0.001), (26, 1.0)])
key_loc(mark_t, [(10, (0, -0.2, 0.90)), (26, (0, -0.62, 0.74))])
key_loc(word, [(8, (0, 0.5, -0.8)), (38, (0, 0, -0.55))])
key_loc(tagline, [(26, (0, 0.35, -1.02)), (52, (0, 0, -1.22))])
visible([mark, mark_t, word, tagline], 1, 120)

# ------------------------------------------------------------------ SCENE 2: headline (121-240)
h1 = text("h1", "Your TV,", 0.94, (-2.55, 0, 0.72), M_INK, extrude=0.05, align="LEFT")
h2 = text("h2", "on your desktop.", 0.94, (-2.55, 0, -0.25), M_ACCENT, extrude=0.05, align="LEFT")
sub2 = text("sub2", "Remote, live screen, one window.", 0.2, (-2.53, 0, -1.15), M_MUTED, extrude=0.005, align="LEFT")

key_loc(h1, [(121, (-2.55, 0.7, 0.95)), (152, (-2.55, 0, 0.72))])
key_loc(h2, [(130, (-2.55, 0.7, -0.02)), (161, (-2.55, 0, -0.25))])
key_loc(sub2, [(156, (-2.53, 0.45, -1.32)), (180, (-2.53, 0, -1.15))])
visible([h1, h2, sub2], 121, 240)

# ------------------------------------------------------------------ SCENE 3: the app window (241-360)
panel_img = bpy.data.images.load(os.path.join(ROOT, "docs", "media", "dashboard.png"))
panel_img.colorspace_settings.name = "sRGB"
panel = quad("panel", 3.95, 2.40, (0, 0, 0.18), tex_mat("panel_mat", panel_img, flat=False))
frame = cube("panel_frame", 1.0, (0, 0.05, 0.18), M_SURFACE, bev=0.02, scale=(4.11, 2.53, 0.06))

key_rot(panel, [(241, (math.radians(90), math.radians(17), 0)), (318, (math.radians(90), 0, 0))])
key_loc(panel, [(241, (0, 0.85, 0.34)), (298, (0, 0, 0.18))])
key_rot(frame, [(241, (math.radians(90), math.radians(17), 0)), (318, (math.radians(90), 0, 0))])
key_loc(frame, [(241, (0, 0.92, 0.34)), (298, (0, 0.05, 0.18))])
visible([panel, frame], 241, 360)

# ------------------------------------------------------------------ SCENE 4: protocols (361-480)
cards = []
data = [("6466 / 6467", "Android TV Remote v2"), ("5555", "ADB host protocol"), ("8060", "Roku ECP")]
for i, (port, label) in enumerate(data):
    x = (i - 1) * 3.05
    card = cube(f"card{i}", 2.9, (x, 0, 0.22), M_CARD, bev=0.05, scale=(0.86, 0.09, 0.82))
    top = text(f"port{i}", port, 0.24, (x, -0.17, 0.58), M_ACCENT, extrude=0.01)
    mid = text(f"name{i}", label, 0.17, (x, -0.17, 0.14), M_INK, extrude=0.006)
    key_loc(card, [(361 + i * 6, (x, 1.3, 0.22)), (394 + i * 6, (x, 0, 0.22))])
    key_loc(top, [(361 + i * 6, (x, 1.0, 0.58)), (394 + i * 6, (x, -0.17, 0.58))])
    key_loc(mid, [(361 + i * 6, (x, 1.0, 0.14)), (394 + i * 6, (x, -0.17, 0.14))])
    key_rot(card, [(361, (0, 0, math.radians(-7))), (470, (0, 0, math.radians(3)))])
    cards += [card, top, mid]

visible(cards, 361, 480)

# ------------------------------------------------------------------ SCENE 5: numbers (481-600)
n1 = text("n1", "166", 1.15, (-2.3, 0, 0.38), M_INK, extrude=0.06)
l1 = text("l1", "AUTOMATED TESTS", 0.14, (-2.3, 0, -0.5), M_MUTED, extrude=0.004)
n2 = text("n2", "3", 1.15, (0.0, 0, 0.38), M_ACCENT, extrude=0.06)
l2 = text("l2", "PROTOCOLS", 0.14, (0.0, 0, -0.5), M_MUTED, extrude=0.004)
n3 = text("n3", "0", 1.15, (2.3, 0, 0.38), M_INK, extrude=0.06)
l3 = text("l3", "ACCOUNTS OR RELAYS", 0.14, (2.3, 0, -0.5), M_MUTED, extrude=0.004)

key_scale(n1, [(481, 0.55), (505, 1.04), (512, 1.0)])
key_scale(n2, [(492, 0.55), (516, 1.04), (523, 1.0)])
key_scale(n3, [(503, 0.55), (527, 1.04), (534, 1.0)])
visible([n1, l1, n2, l2, n3, l3], 481, 600)

# ------------------------------------------------------------------ SCENE 6: CTA (601-720)
mark2 = cube("mark2", 0.9, (0, 0, 1.12), M_ACCENT, bev=0.17)
mark2_t = text("mark2_t", "T", 0.55, (0, -0.49, 1.09), M_BG, extrude=0.02)
cta1 = text("cta1", "Put the remote back", 0.56, (0, 0, 0.1), M_INK, extrude=0.03)
cta2 = text("cta2", "in your hands.", 0.56, (0, 0, -0.55), M_ACCENT, extrude=0.03)
url = text("url", "github.com/NathanKSanal/tellymote", 0.21, (0, 0, -1.3), M_MUTED, extrude=0.005)

key_scale(mark2, [(601, 0.001), (620, 1.05), (628, 1.0)])
key_scale(mark2_t, [(612, 0.001), (628, 1.0)])
key_loc(cta1, [(616, (0, 0.55, 0.33)), (646, (0, 0, 0.1))])
key_loc(cta2, [(624, (0, 0.55, -0.32)), (654, (0, 0, -0.55))])
key_loc(url, [(646, (0, 0.35, -1.45)), (674, (0, 0, -1.3))])
visible([mark2, mark2_t, cta1, cta2, url], 601, 720)

# ------------------------------------------------------------------ camera: one shot per scene
shot(1, -9.2, 0.55, 50)
shot(70, -8.5, 0.45, 50)
shot(120, -8.5, 0.45, 50)

shot(121, -9.4, 0.15, 50)
shot(200, -8.6, 0.10, 50)
shot(240, -8.6, 0.10, 50)

shot(241, -9.8, 0.40, 50)
shot(330, -9.2, 0.36, 52)
shot(360, -9.2, 0.36, 52)

shot(361, -11.6, 0.35, 42)
shot(450, -10.6, 0.32, 42)
shot(480, -10.6, 0.32, 42)

shot(481, -9.2, 0.10, 50)
shot(560, -8.7, 0.10, 50)
shot(600, -8.7, 0.10, 50)

shot(601, -9.6, 0.35, 50)
shot(690, -9.0, 0.30, 50)
shot(720, -9.0, 0.30, 50)

for fc in iter_fcurves(cam):
    for kp in fc.keyframe_points:
        kp.interpolation = "BEZIER"
        kp.easing = "EASE_IN_OUT"
    for kp in fc.keyframe_points:
        if abs(kp.co[0] % 120) < 0.5:
            kp.interpolation = "CONSTANT"

# ------------------------------------------------------------------ render
if os.environ.get("MG_NO_CAP3"):
    for name in ("cap3", "cap4"):
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)

if os.environ.get("MG_NO_WIPE_OBJ"):
    o = bpy.data.objects.get("wipe")
    if o:
        bpy.data.objects.remove(o, do_unlink=True)

if os.environ.get("MG_DEBUG"):
    f = int(os.environ["MG_DEBUG"])
    scene.frame_set(f)
    from bpy_extras.object_utils import world_to_camera_view

    print("---- projected at", f, "----")
    for o in bpy.data.objects:
        if o.type not in {"MESH", "FONT"}:
            continue
        if o.hide_viewport:
            continue
        co = world_to_camera_view(scene, cam, o.matrix_world.translation)
        if abs(co.x - 0.5) < 0.06:
            bb = [o.matrix_world @ __import__("mathutils").Vector(c) for c in o.bound_box]
            zs = [round(world_to_camera_view(scene, cam, v).y, 2) for v in bb]
            print("CENTER", o.name, "x", round(co.x, 2), "yrange", min(zs), max(zs), "hide_vp", o.hide_viewport)
    print("---- visible at", f, "----")
    for o in sorted(bpy.data.objects, key=lambda x: x.name):
        if o.type in {"MESH", "FONT"}:
            print(
                "OBJ",
                o.name,
                "hide_render=", o.hide_render,
                "hide_viewport=", o.hide_viewport,
                "vis=", o.visible_get(),
                "loc=", tuple(round(v, 2) for v in o.location),
            )
    raise SystemExit(0)

if os.environ.get("MG_RANGE"):
    a, b = (int(v) for v in os.environ["MG_RANGE"].split("-"))
    scene.frame_start, scene.frame_end = a, b
    t = time.time()
    bpy.ops.render.render(animation=True)
    print(f"MG_RANGE_OK {a}-{b} seconds={time.time() - t:.1f}")
    raise SystemExit(0)

if MODE == "stills":
    for f in (60, 180, 300, 420, 540, 660):
        scene.frame_set(f)
        scene.render.filepath = os.path.join(OUT, f"still_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"STILL_OK {f}")
else:
    t = time.time()
    bpy.ops.render.render(animation=True)
    print(f"MG_OK frames={END} seconds={time.time() - t:.1f}")

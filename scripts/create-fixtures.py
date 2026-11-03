"""Generate only the lab's disposable demo asset; never touches user models."""
import bpy
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = root / "public" / "models" / "demo-notebook.glb"
target.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def material(name, color, metallic=0.0, roughness=0.3):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return result

body_material = material("COVER", (0.921, 0.896, 0.839))
print_material = material("PRINT_AREA", (1, 1, 1))
paper_material = material("PAPER", (0.85, 0.82, 0.74), 0.0, 0.9)

def box(name, dimensions, location, surface_material, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    result = bpy.context.object
    result.name = name
    result.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = result.modifiers.new("Rounded edges", "BEVEL")
    modifier.width = bevel
    modifier.segments = 5
    result.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    result.data.materials.append(surface_material)
    return result

box("DemoNotebook_FrontCover", (1.9, 0.05, 2.6), (0, -0.15, 0), body_material)
box("DemoNotebook_BackCover", (1.9, 0.05, 2.6), (0, 0.15, 0), body_material)
box("DemoNotebook_Pages", (1.72, 0.25, 2.46), (0.04, 0, 0), paper_material, 0.015)
box("DemoNotebook_Spine", (0.08, 0.34, 2.57), (-0.92, 0, 0), body_material, 0.025)

mesh = bpy.data.meshes.new("PrintSurfaceUV")
mesh.from_pydata([(-0.79, -0.176, -1.17), (0.83, -0.176, -1.17), (0.83, -0.176, 1.17), (-0.79, -0.176, 1.17)], [], [(0, 1, 2, 3)])
mesh.update()
uv = mesh.uv_layers.new(name="UVMap")
for index, point in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
    uv.data[index].uv = point
surface = bpy.data.objects.new("DemoNotebook_PrintArea", mesh)
bpy.context.collection.objects.link(surface)
surface.data.materials.append(print_material)
surface["lab_print_overlay"] = True

bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_yup=True, export_apply=True, export_extras=True)
assert target.is_file() and target.stat().st_size > 0
print(f"LAB_FIXTURE_OK Blender={bpy.app.version_string} path={target} bytes={target.stat().st_size}")

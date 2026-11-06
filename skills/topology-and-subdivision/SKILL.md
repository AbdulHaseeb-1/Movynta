---
name: topology-and-subdivision
version: 1.0.0
description: Plans and checks clean mesh topology (quad flow, edge loops, poles, support loops, even density) so models subdivide, shade and deform well, and fixes pinching, faceting and wasted polygons.
dimensions:
  - 3d
tags:
  - topology
  - quad
  - quads
  - edge loop
  - edge loops
  - edge flow
  - loop cut
  - support loop
  - support loops
  - subdivision
  - subdivide
  - smooth
  - smoothing
  - pinch
  - pinching
  - pole
  - poles
  - n-gon
  - ngon
  - polycount
  - low-poly
  - low poly
  - clean
when_to_use:
  - The user asks for clean topology, quads, edge loops, smoothing, subdivision or a target polygon budget.
  - A subdivided or smooth-shaded model shows pinching, lumps, faceting or shading artefacts.
  - The user asks to make a model low-poly, lighter, or ready for animation.
required_inputs:
  - The object to check or build, from the editor context.
  - Its purpose (static prop, subdivided hero model, animated character, low-poly game asset) and any polygon budget.
tools:
  - editor.get_context
  - editor.inspect_mesh
  - editor.measure
  - viewport.capture
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - The mesh is inspected (counts, boundaries, winding, faces by type) before any topology edit is chosen.
  - Topology-changing edits (loop cut, merge, dissolve, bevel edges, inset, subdivide faces) are proposed alone with the inspection revision and modifiers disabled.
  - The mesh is re-inspected after each topology edit, because component ids change.
  - Wireframe and normals captures after the change show no new pinching, flipped faces or unintended open boundaries.
  - The final triangle count stays within the stated budget, or the report explains why it does not.
error_handling:
  - If a loop cut stops early, the ring hit a triangle, n-gon or boundary; report where, and offer a support bevel or face subdivision instead.
  - If an edit is refused for enabled modifiers, disable the stack, make the edit alone, then restore the stack with the same ids and parameters.
  - If a dissolve or merge is refused, do not force it; leave the topology and explain the blocking seam, material boundary or non-manifold result.
---

# Topology and subdivision

Good topology is invisible: the surface shades smoothly, holds its corners, subdivides predictably and bends where it should. Use `mesh-editing` for the exact command parameters; this skill decides which edits make good topology.

## Principles

- **Quads where it matters.** Quads give clean edge loops, predictable Catmull–Clark subdivision and good deformation. Triangles and n-gons are acceptable on flat, non-deforming, non-subdivided areas (the flat top of a box, the back of a panel). Avoid them on curved surfaces that will be subdivided.
- **Edge flow follows form.** Loops should run along the shape: around eyes, mouths and holes, along the length of limbs and tubes, around joints. Loops that cut across a curve make lumps when smoothed.
- **Poles.** Every closed quad shape needs some vertices with 3 or 5 edges. Put them on flat, low-visibility areas, not on curved highlights or deforming joints. Avoid 6+ edge poles; they pinch when subdivided.
- **Even spacing.** Keep neighbouring faces about the same size and close to square. Long thin faces, sudden density jumps and concave quads shade badly.
- **Density where needed.** Add geometry only where the shape curves, deforms or needs a tight edge. Flat areas need few faces. A mesh full of dense flat areas is "topology bloat".
- **Support loops hold edges.** Subdivision rounds everything. To keep a corner tight, place an edge loop close to it: the closer the loop, the sharper the corner. A 2–3 segment bevel before subdivision does the same job across all edges at once.
- **Manifold and consistent.** Closed solids should have no unintended boundaries, no duplicated vertices and consistent winding, so normals point outward. Check before booleans and before subdivision.
- **Curved primitives need segments.** A cylinder that should look round up close needs 24–48 radial segments; background props can use 8–16. Spheres: width segments about twice the height segments.

## Choose a strategy by purpose

| Purpose | Approach |
| --- | --- |
| Static prop, close up | Low-poly cage + bevel (2–3 segments) + subdivision level 1–2, or bevel alone with `round` profile |
| Static prop, background | No subdivision; chamfer bevel 1 segment; low segment counts |
| Low-poly / game asset | No subdivision; triangles allowed on flat areas; silhouette edges get the polygons |
| Smooth organic or moulded shape | All-quad cage, Catmull–Clark 2, support loops or bevels where it should be tighter |
| Will be animated | Loops around joints (2–3 loops per bending joint), quads only in deforming areas, poles away from joints |

Triangle budgets (rough guides): background prop 100–1,000; mid prop 1,000–10,000; hero prop or character 10,000–20,000 (the editable input limit is 20,000 triangles per generated mesh, so stay well under it before subdivision).

## Workflow

1. `editor.get_context`, then `editor.inspect_mesh` with `includeSamples: false` for counts, boundaries, winding problems, material slots and the live stack. Inspect `view: base` before any component edit.
2. Capture the current state: `viewport.capture` with `focus` on the object, views `front`, `right`, `isometric`, once in `wireframe` and once in `normals`. Name what you see (pinch at the top pole, faceting on the cylinder, a density jump on the lid).
3. Decide the fix:
   - Faceted curved surface: more segments (replace the primitive only if the user agrees) or a subdivision modifier with a bevel before it.
   - Corners too soft after subdivision: add a bevel entry before the subdivision entry, or a `geometry.loop_cut` near the edge with `factor` close to 0 or 1 (for example 0.1).
   - Corners too sharp: increase bevel segments, or use `round`/`circular` profiles.
   - Pinching at a pole: move the pole to a flatter area by sliding edges (`geometry.slide_edges`) or adding a loop to spread the faces.
   - Too dense on flat areas: `geometry.dissolve_edges` on coplanar regions, or `geometry.merge_vertices` for duplicate points.
   - Only part of a mesh needs more detail: `geometry.subdivide_faces` on those faces, not `geometry.subdivide` on everything.
   - An unintended hole: `geometry.fill_hole` with the boundary edge ids.
4. Make each topology-changing edit in its own proposal, with modifiers disabled and the base inspection revision. Re-inspect after it applies because ids change.
5. Restore the modifier stack with `geometry.set_modifiers`, preserving ids and order (mirror/array, boolean, bevel, subdivision).
6. Capture again with the same cameras in `wireframe` and `normals` and compare before and after. Check the triangle count from `editor.inspect_mesh` against the budget.
7. `validation.check_scene` and report the fix, the before/after counts, and any area that is still compromised.

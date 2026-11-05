import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Control {
  action: string;
  keys: string;
  detail: string;
}

interface ControlGroup {
  name: string;
  context: string;
  controls: readonly Control[];
}

const groups: readonly ControlGroup[] = [
  {
    name: "Viewport navigation",
    context: "In the 3D viewport",
    controls: [
      { action: "Orbit", keys: "Drag", detail: "Drag the viewport to rotate the view when navigation is active." },
      { action: "Pan", keys: "H / Space + drag", detail: "Choose the Hand tool with H, or hold Space and drag temporarily." },
      { action: "Zoom", keys: "Scroll / = / + / −", detail: "Scroll or use =, + and − to move the camera closer or farther away." },
      { action: "Reset view", keys: "0", detail: "Return the camera to its starting view." },
      { action: "Measurements", keys: "Ruler button · Esc / right-click to cancel", detail: "Choose Distance or Angle and pick viewport points with a live preview. Snap controls select Surface, Vertex or Grid; hold Shift for a triangle vertex or Alt for the unit ground grid. Inspect selected dimensions in World/Local axes, read an Edit-mode edge, or measure gaps between two objects. Save named annotations and use the eye to hide them. Scene scale controls calibration. If loading fails or another session changes measurements, reload and review the latest settings before saving again." },
    ],
  },
  {
    name: "Object mode",
    context: "Select and edit whole objects",
    controls: [
      { action: "Select tool", keys: "V", detail: "Select objects by clicking them. Shift-click adds or removes an object." },
      { action: "Select all / clear", keys: "A / Alt + A", detail: "Select all objects or clear the selection." },
      { action: "Box select", keys: "B, then drag", detail: "Draw a selection rectangle. Hold Shift to add objects. In Select mode, drag empty space to start directly." },
      { action: "Move", keys: "G", detail: "Move selected objects, or choose the Move tool from the toolbar." },
      { action: "Rotate", keys: "R", detail: "Rotate selected objects, or choose the Rotate tool." },
      { action: "Scale", keys: "S", detail: "Scale selected objects, or choose the Scale tool." },
      { action: "Constrain transform", keys: "X / Y / Z", detail: "During a keyboard transform, constrain it to an axis. Press the same key again to release it." },
      { action: "Exact object transform", keys: "Type a number / Backspace", detail: "During G, R or S, type a signed distance, rotation in degrees, or scale factor from 0.001 to 100. Without an axis, movement follows camera-right and rotation uses the view axis. Backspace edits the value." },
      { action: "Confirm / cancel transform", keys: "Enter / click · Esc / right-click", detail: "Confirm the preview or restore the original transforms." },
      { action: "Snap gizmo", keys: "Shift + drag", detail: "Hold Shift while dragging a transform handle to snap its movement." },
      { action: "Delete selected object", keys: "Delete / X", detail: "Delete the active object using the confirmation flow." },
      { action: "Deselect", keys: "Esc", detail: "Clear the object selection, or cancel an active selection rectangle." },
      { action: "Add shape", keys: "Add shape menu", detail: "Add a cube, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron." },
      { action: "Duplicate object", keys: "Shift + D", detail: "Duplicate the selected object and its registered children in place, then move the selected copy." },
      { action: "Mirror controls", keys: "Ctrl + M", detail: "Open Modifiers, then add Mirror / symmetry and choose its settings." },
      { action: "Import model", keys: "Import button", detail: "Choose a supported 3D model file to add it to the project." },
    ],
  },
  {
    name: "Edit mode",
    context: "Select vertices, edges or faces on the active mesh",
    controls: [
      { action: "Change mode", keys: "E / O · mode menu", detail: "E enters Edit mode from Object mode; O returns to Object mode. E in Edit mode starts extrusion." },
      { action: "Component selection", keys: "Click / Shift + click", detail: "Choose vertex, edge or face selection in the toolbar. Shift-click adds or removes components." },
      { action: "Box select components", keys: "B, then drag", detail: "Select component centers in the rectangle. Hold Shift to add. Esc cancels the rectangle." },
      { action: "Clear components", keys: "Esc", detail: "Clear the current component selection when no edit preview is active." },
      { action: "Move / rotate / scale faces", keys: "G / R / S", detail: "Transform selected faces. Use X, Y or Z to constrain an axis." },
      { action: "Extrude region", keys: "E", detail: "Extrude selected vertices, edges or faces. Selected faces start along their average normal when available." },
      { action: "Other extrusion tools", keys: "Extrusion menu", detail: "Extrude faces along vertex normals, extrude individual faces, or close an entire planar sheet as a solid." },
      { action: "Inset faces", keys: "I", detail: "Create a border around selected faces. See the inset controls below." },
      { action: "Bevel edges", keys: "Ctrl + B", detail: "With edges selected, start a bevel preview. See the bevel controls below." },
      { action: "Subdivide selected faces", keys: "Subdivide button", detail: "Split only the selected faces in the base mesh." },
      { action: "Merge vertices", keys: "M / Mesh menu", detail: "Select at least two vertices, then choose center, first selected or last selected. The edit saves immediately and supports Undo." },
      { action: "Dissolve edges", keys: "Mesh menu", detail: "Remove selected internal edges in a coplanar region. Seams, material boundaries and invalid topology are rejected." },
      { action: "Fill hole", keys: "F / Mesh menu", detail: "Select one complete boundary loop of 3–256 edges and close it. The edit saves immediately and supports Undo." },
      { action: "Confirm / cancel preview", keys: "Enter / click · Esc / right-click", detail: "Apply the displayed component edit or restore the original mesh." },
    ],
  },
  {
    name: "During face extrusion",
    context: "After starting an extrusion of faces",
    controls: [
      { action: "Move cap", keys: "G", detail: "Move the extruded cap. Use X, Y or Z to constrain the movement." },
      { action: "Scale cap", keys: "S", detail: "Scale the extruded cap after giving the extrusion a distance." },
      { action: "Rotate cap", keys: "R", detail: "Twist the cap. Then use X, Y or Z to rotate around a mesh-local axis." },
    ],
  },
  {
    name: "During bevel",
    context: "After starting Bevel Edges in Edit mode",
    controls: [
      { action: "Bevel width", keys: "Move pointer / type a number", detail: "Adjust the width in mesh-local units, or enter a value up to 100. Backspace edits the entry; move the pointer to adjust a typed width." },
      { action: "Fine adjustment", keys: "Shift + move pointer", detail: "Hold Shift while moving the pointer for finer width adjustment." },
      { action: "Bevel segments", keys: "Scroll", detail: "Change the number of segments from 1 to 32." },
      { action: "Confirm / cancel bevel", keys: "Enter / click · Esc / right-click", detail: "Save the preview or restore the original mesh." },
    ],
  },
  {
    name: "During inset",
    context: "After starting Inset Faces in Edit mode",
    controls: [
      { action: "Thickness", keys: "Move pointer / type a number", detail: "Adjust the width of the border or enter an exact value." },
      { action: "Depth", keys: "Ctrl + move / D", detail: "Hold Ctrl and move to adjust depth. D switches the active field for pointer movement and numeric entry." },
      { action: "Region / Individual", keys: "I", detail: "Inset connected faces together or give each face its own border." },
      { action: "Outset", keys: "O", detail: "Create the border in surrounding faces. Outset uses Region mode." },
      { action: "Boundary", keys: "B", detail: "Include open mesh edges in a region inset. Individual faces always get complete borders." },
      { action: "Even offset", keys: "E", detail: "Maintain a more even border width along edges." },
      { action: "Relative offset", keys: "L", detail: "Scale the offset and depth using the lengths of inset edges." },
      { action: "Edge rail", keys: "R", detail: "Follow existing interior edges where possible in Region mode." },
      { action: "Select outer", keys: "S", detail: "Switch the resulting selection between inner faces and the new border." },
      { action: "Interpolate", keys: "U", detail: "Interpolate supported mesh attributes, including UVs, onto new geometry." },
      { action: "Confirm / cancel inset", keys: "Enter / click · Esc / right-click", detail: "Save the preview or cancel it." },
    ],
  },
  {
    name: "Scene and collections",
    context: "When a row in the Scene list has focus",
    controls: [
      { action: "Navigate rows", keys: "↑ / ↓ / Home / End", detail: "Move between rows, or go to the first or last row." },
      { action: "Expand / collapse", keys: "→ / ←", detail: "Open or close a branch. Left also moves to its parent." },
      { action: "Choose a row", keys: "Enter / Space", detail: "Select the object or choose the collection." },
      { action: "Rename", keys: "F2 / double-click name", detail: "Rename an object or collection. Enter saves and Esc cancels." },
      { action: "Multi-select objects", keys: "Ctrl / Shift + click", detail: "Toggle an object in the selection." },
      { action: "Organize objects", keys: "Drag a row", detail: "Drop on an object to parent it, on a collection to move it there, or on the strip to remove its parent." },
      { action: "Organize collections", keys: "Drag a collection", detail: "Drop on a collection to nest it, or on Scene collection to move it to the top." },
      { action: "Visibility", keys: "Eye button", detail: "Show or hide an object or collection." },
      { action: "New / delete collection", keys: "New collection button / Delete", detail: "Create a collection or delete an empty collection. Select a collection first to create one inside it." },
    ],
  },
  {
    name: "History, values and chat",
    context: "Project editing and the assistant",
    controls: [
      { action: "Undo / redo", keys: "Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y", detail: "Undo with Ctrl + Z. Redo with Ctrl + Shift + Z or Ctrl + Y. Use Command on macOS." },
      { action: "Adjust a value", keys: "Drag label / arrow keys", detail: "Drag a numeric label, or focus it and use arrow keys. Hold Shift for finer label adjustments." },
      { action: "Enter a value", keys: "Click value / Enter / Esc", detail: "Type a value and press Enter to apply it, or Esc to cancel." },
      { action: "Modifiers", keys: "Modifiers panel", detail: "Add Bevel, Subdivision, Boolean, Array or Mirror. Configure, reorder, enable or remove modifiers, then apply the changes. Existing live extrusions can also be adjusted here." },
      { action: "Project name", keys: "Click project name", detail: "Rename the project. Enter saves and Esc cancels." },
      { action: "Project actions", keys: "Project actions menu", detail: "Access project actions such as duplicating or deleting the current project." },
      { action: "Send a message", keys: "Enter", detail: "Send the current message from the assistant composer." },
      { action: "New line", keys: "Shift + Enter", detail: "Add a line in the assistant composer." },
      { action: "Stop assistant", keys: "Esc", detail: "Stop the current run while the assistant composer has focus." },
      { action: "Model and reasoning", keys: "Composer menus", detail: "Choose the provider, model and available reasoning effort for the assistant." },
      { action: "Approve or reject", keys: "Approval card", detail: "Review an assistant proposal and choose whether to apply it." },
      { action: "Copy or retry response", keys: "Message actions", detail: "Copy a response or retry an eligible message from its actions." },
      { action: "Browse captures", keys: "← / →", detail: "Move between images while the capture gallery is open." },
    ],
  },
  {
    name: "Projects",
    context: "On the home page",
    controls: [
      { action: "New project", keys: "New project button", detail: "Choose a project category and open a new workspace." },
      { action: "Find projects", keys: "Search / filters", detail: "Search by name, switch between all, starred and archived projects, or filter by category and sort order." },
      { action: "Open a project", keys: "Click project card", detail: "Open the project in the workspace." },
      { action: "Manage a project", keys: "Project actions menu", detail: "Rename, star, duplicate, archive, restore or delete a project." },
    ],
  },
];

export function ControlsSettings() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const matching = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups.filter((group) => category === "All" || group.name === category).map((group) => ({
      ...group,
      controls: group.controls.filter((control) => {
        const text = `${group.name} ${group.context} ${control.action} ${control.keys} ${control.detail}`.toLowerCase();
        const compact = text.replace(/\s+/g, "");
        return words.every((word) => text.includes(word) || compact.includes(word));
      }),
    })).filter((group) => group.controls.length > 0);
  }, [category, query]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="controls-settings-heading" className="text-[17px] font-semibold">Shortcuts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Keyboard, mouse and toolbar controls for your workspace.
          </p>
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search shortcuts"
            placeholder={category === "All" ? "Search shortcuts" : "Search this category"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 bg-background pl-9 text-xs"
          />
        </div>
      </div>
      <nav aria-label="Shortcut categories" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {["All", ...groups.map((group) => group.name)].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              category === name && "bg-secondary font-medium text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </nav>
      {matching.length === 0 && <output className="block py-4 text-sm text-muted-foreground">No controls match your search.</output>}
      {matching.map((group) => (
        <section key={group.name} aria-label={group.name}>
          <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-xs font-semibold">{group.name}</h3>
            <p className="text-[11px] text-muted-foreground">{group.context}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card/50">
            {group.controls.map((control) => (
              <div key={control.action} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.6fr)_auto] sm:items-center">
                <p className="min-w-0 text-xs font-medium">{control.action}</p>
                <kbd className="col-start-2 row-start-1 max-w-44 rounded border border-border bg-muted px-1.5 py-0.5 text-right font-sans text-[11px] leading-4 text-foreground sm:col-start-3 sm:max-w-48">
                  {control.keys}
                </kbd>
                <p className="col-span-2 min-w-0 text-[11px] leading-4 text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">{control.detail}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import { chordsOf } from "./keys";

export interface ShortcutControl {
  readonly action: string;
  /** Written in the key grammar of `keys.ts`, so it can be drawn as key caps and found from a key press. */
  readonly keys: string;
  readonly detail: string;
  /** The id of the tool guide entry that explains this control, for a "Learn more" link. */
  readonly guide?: string;
}

export interface ShortcutGroup {
  readonly id: string;
  readonly name: string;
  /** Where the controls apply, such as "In the 3D viewport". */
  readonly context: string;
  readonly controls: readonly ShortcutControl[];
}

/** Every keyboard, mouse and toolbar control. Keep it aligned with the editor and with `toolGuide.ts`. */
export const shortcutGroups: readonly ShortcutGroup[] = [
  {
    id: "help",
    name: "Help",
    context: "Anywhere in the app",
    controls: [
      { action: "Keyboard shortcuts", keys: "? / F1", detail: "Open this list from any page. Search it, or pick a category. It does not open while you type in a field, except with F1.", guide: "keyboard-shortcuts" },
      { action: "Search the documentation", keys: "/", detail: "On the documentation page, move to the search field.", guide: "documentation" },
      { action: "Look up a key", keys: "Shortcuts tab", detail: "On the documentation page, open Shortcuts and press any key or combination to see what it does in each mode.", guide: "documentation" },
    ],
  },
  {
    id: "navigation",
    name: "Viewport navigation",
    context: "In the 3D viewport",
    controls: [
      { action: "Orbit", keys: "Drag", detail: "Drag the viewport in Object mode, right-drag in Edit mode, or drag the orientation gizmo to rotate the view.", guide: "orbit" },
      { action: "Pan", keys: "H / Space+Drag", detail: "Choose the Hand tool with H, or hold Space and drag temporarily.", guide: "pan" },
      { action: "Zoom", keys: "Scroll / = / + / −", detail: "Scroll or use =, + and − to move the camera closer or farther away. These navigation keys work in Object and Edit mode.", guide: "zoom" },
      { action: "Reset view", keys: "0", detail: "Return the camera to its starting view.", guide: "zoom" },
      { action: "Front / right / top view", keys: "Numpad 1 / Numpad 3 / Numpad 7", detail: "Look at the same point from the front, right or top. Click the orientation gizmo axes for these views; the View from menu also offers an isometric view.", guide: "view-presets" },
      { action: "Back / left / bottom view", keys: "Ctrl+Numpad 1 / Ctrl+Numpad 3 / Ctrl+Numpad 7", detail: "Look from the opposite side of the front, right or top view.", guide: "view-presets" },
      { action: "Frame selected / all", keys: ". / Home", detail: "Move the camera to show the selected objects, or everything when nothing is selected. Home always frames the whole scene.", guide: "frame" },
      { action: "Wireframe on / off", keys: "Shift+Z", detail: "Switch to Wireframe shading, or back to the shading used before it. The shading buttons next to Import choose Material, Solid or Wireframe directly.", guide: "viewport-shading" },
      { action: "X-ray", keys: "Alt+Z", detail: "See through surfaces in Solid or Wireframe; in the material view it switches to Solid. While it is on, Edit-mode selection also reaches hidden components. The grid button beside it shows or hides the floor grid.", guide: "viewport-shading" },
      { action: "Measurements", keys: "Ruler button · Esc / Right-click", detail: "Choose Distance or Angle and pick viewport points with a live preview; Esc or right-click cancels picking. Snap controls select Surface, Vertex or Grid; hold Shift for a triangle vertex or Alt for the unit ground grid. Inspect selected dimensions in World/Local axes, read an Edit-mode edge, or measure gaps between two objects. Save named annotations and use the eye to hide them. Scene scale controls calibration. If loading fails or another session changes measurements, reload and review the latest settings before saving again.", guide: "measurement" },
    ],
  },
  {
    id: "object",
    name: "Object mode",
    context: "Select and edit whole objects",
    controls: [
      { action: "Select tool", keys: "V", detail: "Select objects by clicking them. Shift-click adds or removes an object; Alt-click cycles through overlapping objects.", guide: "select" },
      { action: "Select all / clear", keys: "A / Alt+A", detail: "Select all objects or clear the selection.", guide: "select" },
      { action: "Box select", keys: "B then Drag", detail: "Draw a rectangle around object centers. Hold Shift to add, Alt to subtract, or Shift+Alt to intersect. In Select mode, drag empty space to start directly.", guide: "select" },
      { action: "Move", keys: "G", detail: "Move selected objects, or choose the Move tool from the toolbar.", guide: "transform" },
      { action: "Rotate", keys: "R", detail: "Rotate selected objects, or choose the Rotate tool.", guide: "transform" },
      { action: "Scale", keys: "S", detail: "Scale selected objects, or choose the Scale tool.", guide: "transform" },
      { action: "Constrain transform", keys: "X / Y / Z", detail: "During a keyboard transform, constrain it to an axis. Press the same key again to release it.", guide: "transform" },
      { action: "Exact object transform", keys: "Type a number / Backspace", detail: "During G, R or S, type a signed distance, rotation in degrees, or scale factor from 0.001 to 100. Without an axis, movement follows camera-right and rotation uses the view axis. Backspace edits the value.", guide: "numeric-transform" },
      { action: "Confirm / cancel transform", keys: "Enter / Click · Esc / Right-click", detail: "Confirm the preview or restore the original transforms.", guide: "transform" },
      { action: "Snap gizmo", keys: "Shift+Drag", detail: "Hold Shift while dragging a transform handle to snap its movement.", guide: "transform" },
      { action: "Delete selected object", keys: "Delete / X", detail: "Delete the selected objects at once. There is no confirmation; use Undo to bring them back. Delete does nothing in Edit mode.", guide: "delete" },
      { action: "Deselect", keys: "Esc", detail: "Clear the object selection, or cancel an active selection rectangle.", guide: "select" },
      { action: "Add shape", keys: "Add shape menu", detail: "Add a cube, sphere, cylinder, cone, torus, plane, tetrahedron, octahedron or icosahedron.", guide: "add" },
      { action: "Duplicate object", keys: "Shift+D", detail: "Duplicate the selected object and its registered children in place, then move the selected copy.", guide: "duplicate-object" },
      { action: "Mirror controls", keys: "Ctrl+M", detail: "Open Modifiers, then add Mirror / symmetry and choose its settings.", guide: "mirror-modifier" },
      { action: "Import model", keys: "Import button", detail: "Choose a supported 3D model file to add it to the project.", guide: "import" },
      { action: "Export for Blender", keys: "Export button", detail: "Save the selected objects as one .glb file for Blender, with their names, placement, materials and size.", guide: "export-selection" },
    ],
  },
  {
    id: "edit",
    name: "Edit mode",
    context: "Select vertices, edges or faces on the active mesh",
    controls: [
      { action: "Change mode", keys: "E / O · Mode menu", detail: "E enters Edit mode from Object mode; O returns to Object mode. E in Edit mode starts extrusion.", guide: "mode-switch" },
      { action: "Component selection", keys: "Click / Shift+Click", detail: "Choose vertex, edge or face selection in the toolbar. Shift-click adds or removes components.", guide: "components" },
      { action: "Box select components", keys: "B then Drag", detail: "Drag, or press B and drag, to select visible component centers. X-ray (Alt+Z) includes hidden components. Hold Shift to add, Alt to subtract, or Shift+Alt to intersect. Esc cancels the rectangle.", guide: "components" },
      { action: "Select all / clear components", keys: "A / Alt+A / Esc", detail: "Select all components in the active mesh part, or clear the selection when no edit preview is active. Use the selection menu to grow, shrink, or select connected components.", guide: "components" },
      { action: "Move / rotate / scale components", keys: "G / R / S", detail: "Transform selected vertices, edges or faces around the middle of the selection. Use X, Y or Z to constrain an axis.", guide: "face-transform" },
      { action: "Extrude region", keys: "E", detail: "Extrude selected vertices, edges or faces. Selected faces start along their average normal when available.", guide: "extrude" },
      { action: "Other extrusion tools", keys: "Extrusion menu", detail: "Extrude faces along vertex normals, extrude individual faces, or close an entire planar sheet as a solid.", guide: "extrude-variants" },
      { action: "Inset faces", keys: "I", detail: "Create a border around selected faces. See the inset controls below.", guide: "inset" },
      { action: "Bevel edges", keys: "Ctrl+B", detail: "With edges selected, start a bevel preview. See the bevel controls below.", guide: "bevel-edges" },
      { action: "Knife", keys: "K / Shift+K", detail: "Start Knife on the active mesh part, or on selected faces only. Click Knife’s arrow for tool settings. See the Knife controls below.", guide: "knife" },
      { action: "Subdivide selected faces", keys: "Subdivide button", detail: "Split only the selected faces in the base mesh.", guide: "subdivide-faces" },
      { action: "Merge vertices", keys: "M / Mesh menu", detail: "Select at least two vertices, then choose center, first selected or last selected. The edit saves immediately and supports Undo.", guide: "merge-vertices" },
      { action: "Dissolve edges", keys: "Mesh menu", detail: "Remove selected internal edges in a coplanar region. Seams, material boundaries and invalid topology are rejected.", guide: "dissolve-edges" },
      { action: "Fill hole", keys: "F / Mesh menu", detail: "Select one complete boundary loop of 3–256 edges and close it. The edit saves immediately and supports Undo.", guide: "fill-hole" },
      { action: "Confirm / cancel preview", keys: "Enter / Click · Esc / Right-click", detail: "Apply the displayed component edit or restore the original mesh." },
    ],
  },
  {
    id: "extrusion",
    name: "During face extrusion",
    context: "After starting an extrusion of faces",
    controls: [
      { action: "Move cap", keys: "G", detail: "Move the extruded cap. Use X, Y or Z to constrain the movement.", guide: "extrude" },
      { action: "Scale cap", keys: "S", detail: "Scale the extruded cap after giving the extrusion a distance.", guide: "extrude" },
      { action: "Rotate cap", keys: "R", detail: "Twist the cap. Then use X, Y or Z to rotate around a mesh-local axis.", guide: "extrude" },
    ],
  },
  {
    id: "knife",
    name: "During Knife",
    context: "After pressing K or Shift+K in Edit mode",
    controls: [
      { action: "Draw a cut", keys: "Click / Drag", detail: "Click points, or drag one straight stroke, across complete face boundaries. Each straight stroke can cross several faces. Interior endpoints, loose edges, nonplanar affected faces, freehand curved strokes and non-affine attribute changes are unsupported.", guide: "knife" },
      { action: "Confirm / cancel", keys: "Enter / Esc", detail: "Save the whole path as one undoable edit, or restore the original mesh. Loss of focus or a scene change also cancels.", guide: "knife" },
      { action: "New disconnected cut", keys: "Right-click / E", detail: "Start a separate line while retaining earlier cuts.", guide: "knife" },
      { action: "Undo stroke", keys: "Ctrl+Z", detail: "Remove the last stroke and every face cut it created.", guide: "knife" },
      { action: "Midpoint / ignore snap (hold)", keys: "Shift / Ctrl", detail: "Hold Shift to snap to edge midpoints, or Ctrl to ignore snapping to vertices and edges.", guide: "knife" },
      { action: "Cut through / X-ray path", keys: "C / V", detail: "Toggle cutting occluded faces, or displaying hidden path edges. Cut-through and path visibility are independent.", guide: "knife" },
      { action: "Angle constraint", keys: "A / Type a number / Backspace", detail: "Cycle off, screen and surface-relative snapping. Type an increment greater than zero and at most 180 degrees. Backspace edits it.", guide: "knife" },
      { action: "Reference edge", keys: "R", detail: "Cycle the surface edge used by relative angle snapping. Start on a surface to use relative mode.", guide: "knife" },
      { action: "Axis constraint", keys: "X / Y / Z", detail: "Cycle the chosen global axis, object-local axis and unconstrained line.", guide: "knife" },
      { action: "Measurements", keys: "S", detail: "Cycle distance, angles, both and off. Distances use world units when both endpoints hit a surface and pixels otherwise. Angles state their frame.", guide: "knife" },
      { action: "Navigate", keys: "Middle-drag / Space+Drag", detail: "Orbit or pan while retaining cuts. Navigation starts a new cutting line.", guide: "knife" },
    ],
  },
  {
    id: "bevel",
    name: "During bevel",
    context: "After starting Bevel Edges in Edit mode",
    controls: [
      { action: "Bevel width", keys: "Move pointer / Type a number", detail: "Adjust the width in mesh-local units, or enter a value up to 100. Backspace edits the entry; move the pointer to adjust a typed width.", guide: "bevel-edges" },
      { action: "Fine adjustment", keys: "Shift+Move pointer", detail: "Hold Shift while moving the pointer for finer width adjustment.", guide: "bevel-edges" },
      { action: "Bevel segments", keys: "Scroll", detail: "Change the number of segments from 1 to 32.", guide: "bevel-edges" },
      { action: "Confirm / cancel bevel", keys: "Enter / Click · Esc / Right-click", detail: "Save the preview or restore the original mesh.", guide: "bevel-edges" },
    ],
  },
  {
    id: "inset",
    name: "During inset",
    context: "After starting Inset Faces in Edit mode",
    controls: [
      { action: "Thickness", keys: "Move pointer / Type a number", detail: "Adjust the width of the border or enter an exact value.", guide: "inset" },
      { action: "Depth", keys: "Ctrl+Move pointer / D", detail: "Hold Ctrl and move to adjust depth. D switches the active field for pointer movement and numeric entry.", guide: "inset" },
      { action: "Region / Individual", keys: "I", detail: "Inset connected faces together or give each face its own border.", guide: "inset" },
      { action: "Outset", keys: "O", detail: "Create the border in surrounding faces. Outset uses Region mode.", guide: "inset" },
      { action: "Boundary", keys: "B", detail: "Include open mesh edges in a region inset. Individual faces always get complete borders.", guide: "inset" },
      { action: "Even offset", keys: "E", detail: "Maintain a more even border width along edges.", guide: "inset" },
      { action: "Relative offset", keys: "L", detail: "Scale the offset and depth using the lengths of inset edges.", guide: "inset" },
      { action: "Edge rail", keys: "R", detail: "Follow existing interior edges where possible in Region mode.", guide: "inset" },
      { action: "Select outer", keys: "S", detail: "Switch the resulting selection between inner faces and the new border.", guide: "inset" },
      { action: "Interpolate", keys: "U", detail: "Interpolate supported mesh attributes, including UVs, onto new geometry.", guide: "inset" },
      { action: "Confirm / cancel inset", keys: "Enter / Click · Esc / Right-click", detail: "Save the preview or cancel it.", guide: "inset" },
    ],
  },
  {
    id: "scene",
    name: "Scene and collections",
    context: "When a row in the Scene list has focus",
    controls: [
      { action: "Navigate rows", keys: "↑ / ↓ / Home / End", detail: "Move between rows, or go to the first or last row.", guide: "scene-list" },
      { action: "Expand / collapse", keys: "→ / ←", detail: "Open or close a branch. Left also moves to its parent.", guide: "scene-list" },
      { action: "Choose a row", keys: "Enter / Space", detail: "Select the object or choose the collection.", guide: "scene-list" },
      { action: "Rename", keys: "F2 / Double-click", detail: "Rename an object or collection; double-click its name. Enter saves and Esc cancels.", guide: "scene-list" },
      { action: "Multi-select objects", keys: "Ctrl+Click / Shift+Click", detail: "Ctrl or Command-click toggles an object. Shift-click selects the visible range between rows.", guide: "scene-list" },
      { action: "Organize objects", keys: "Drag", detail: "Drag a row onto an object to parent it, onto a collection to move it there, or onto the strip to remove its parent.", guide: "scene-list" },
      { action: "Organize collections", keys: "Drag", detail: "Drag a collection onto another to nest it, or onto Scene collection to move it to the top.", guide: "scene-list" },
      { action: "Visibility", keys: "Eye button", detail: "Show or hide an object or collection.", guide: "visibility-selection" },
      { action: "New / delete collection", keys: "New collection button / Delete", detail: "Create a collection or delete an empty collection. Select a collection first to create one inside it.", guide: "scene-list" },
    ],
  },
  {
    id: "history",
    name: "History, values and chat",
    context: "Project editing and the assistant",
    controls: [
      { action: "Undo / redo", keys: "Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y", detail: "Undo with Ctrl+Z. Redo with Ctrl+Shift+Z or Ctrl+Y. Use Command on macOS. The Undo and Redo buttons in the Object-mode toolbar do the same. Works in Edit mode too, but not while the assistant runs.", guide: "history" },
      { action: "Adjust a value", keys: "Drag / Arrow keys", detail: "Drag a numeric label, or focus it and use the arrow keys. Hold Shift for finer label adjustments." },
      { action: "Enter a value", keys: "Click / Enter / Esc", detail: "Click a value and type, then press Enter to apply it or Esc to cancel." },
      { action: "Modifiers", keys: "Modifiers panel", detail: "Add Bevel, Subdivision, Boolean, Array or Mirror. Configure, reorder, enable or remove modifiers, then apply the changes. Existing live extrusions can also be adjusted here.", guide: "modifier-stack" },
      { action: "Project name", keys: "Click", detail: "Click the project name to rename the project. Enter saves and Esc cancels.", guide: "project-library" },
      { action: "Project actions", keys: "Project actions menu", detail: "Access project actions such as duplicating or deleting the current project.", guide: "project-library" },
      { action: "Send a message", keys: "Enter", detail: "Send the current message from the assistant composer.", guide: "assistant-chat" },
      { action: "New line", keys: "Shift+Enter", detail: "Add a line in the assistant composer.", guide: "assistant-chat" },
      { action: "Clear chat", keys: "Assistant header", detail: "Clear the saved conversation and start a new session while keeping the scene and undo history.", guide: "clear-chat" },
      { action: "Stop assistant", keys: "Esc", detail: "Stop the current run while the assistant composer has focus.", guide: "assistant-chat" },
      { action: "Model and reasoning", keys: "Composer menus", detail: "Choose the provider, model and available reasoning effort for the assistant.", guide: "assistant-chat" },
      { action: "Approve or reject", keys: "Approval card", detail: "Review an assistant proposal and choose whether to apply it.", guide: "assistant-chat" },
      { action: "Copy or retry response", keys: "Message actions", detail: "Copy a response or retry an eligible message from its actions.", guide: "assistant-chat" },
      { action: "Browse captures", keys: "← / →", detail: "Move between images while the capture gallery is open.", guide: "assistant-captures" },
    ],
  },
  {
    id: "projects",
    name: "Projects",
    context: "On the home page",
    controls: [
      { action: "New project", keys: "New project button", detail: "Choose a project category and open a new workspace.", guide: "project-library" },
      { action: "Find projects", keys: "Search / filters", detail: "Search by name, switch between all, starred and archived projects, or filter by category and sort order.", guide: "project-library" },
      { action: "Open a project", keys: "Click", detail: "Click a project card to open the project in the workspace.", guide: "project-library" },
      { action: "Manage a project", keys: "Project actions menu", detail: "Rename, star, duplicate, archive, restore or delete a project.", guide: "project-library" },
    ],
  },
];

/** The groups and controls that match every word of the search, optionally within one group. */
export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
  groupId: string | undefined,
): ShortcutGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .filter((group) => groupId === undefined || group.id === groupId)
    .map((group) => ({
      ...group,
      controls: group.controls.filter((control) => {
        const text = `${group.name} ${group.context} ${control.action} ${control.keys} ${control.detail}`.toLowerCase();
        const compact = text.replace(/\s+/g, "");
        return words.every((word) => text.includes(word) || compact.includes(word));
      }),
    }))
    .filter((group) => group.controls.length > 0);
}

export interface ShortcutMatch {
  readonly group: ShortcutGroup;
  readonly control: ShortcutControl;
}

/** Every control a chord such as "Ctrl+Z" triggers, in each context where it does something. */
export function findShortcuts(groups: readonly ShortcutGroup[], chord: string): ShortcutMatch[] {
  return groups.flatMap((group) =>
    group.controls
      .filter((control) => chordsOf(control.keys).includes(chord))
      .map((control) => ({ group, control })),
  );
}

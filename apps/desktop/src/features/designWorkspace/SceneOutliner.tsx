import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { MAX_COMMANDS_PER_PROPOSAL } from "@movynta/editor-protocol";
import { Box, ChevronDown, ChevronRight, Eye, EyeOff, Ellipsis, Folder, FolderOpen, FolderPlus, Group, Layers3, Trash2 } from "lucide-react";
import type { EditorScene } from "@/features/assistant";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { errorMessage, type SerialQueue } from "@/lib";
import {
  buildSceneTree,
  collectionRowId,
  dropAction,
  dropCommands,
  flattenTree,
  outlineCommands,
  objectRange,
  revealed,
  ROOT_ROW_ID,
  rowTarget,
  scrollToRow,
  visibleRange,
  type SceneTree,
  type TreeRow,
} from "./sceneTree";
import { LIST_ATTRIBUTE, ROW_ATTRIBUTE, useRowDrag } from "./useRowDrag";

/** Height of one line, and the most height the list takes before it scrolls. */
const ROW_HEIGHT = 28;
const MAX_LIST_HEIGHT = 280;
const INDENT = 14;
const EMPTY_TREE = buildSceneTree([]);
const NO_SELECTION: readonly string[] = [];

interface SceneOutlinerProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
}

interface Model {
  readonly tree: SceneTree;
  readonly selected: readonly string[];
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/** Takes the focus and selects the text when the name field appears. The function never changes, so this runs once. */
function useFocusOnMount() {
  return useCallback((node: HTMLInputElement | null) => {
    node?.focus();
    node?.select();
  }, []);
}

/**
 * The scene as a tree: collections with what is in them, objects with their children below them. A line can be
 * selected, shown or hidden, renamed (double click or F2), and moved by dragging: an object onto another object to
 * become its child or onto a collection to go into it, a collection onto another to nest it. Every change is saved as
 * the same command the assistant would propose. Only the lines in view are drawn.
 */
export function SceneOutliner({ scene, saves, disabled }: SceneOutlinerProps) {
  const [model, setModel] = useState<Model>({ tree: EMPTY_TREE, selected: NO_SELECTION });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  /** The collection or scene line that is chosen, when an object is not. */
  const [chosenRow, setChosenRow] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectionAnchor = useRef<string | null>(null);
  const cancelled = useRef(false);
  const scrolledTo = useRef<string | null>(null);
  const keyboardMoved = useRef(false);
  /** A collection just made, whose name is asked for as soon as it appears. */
  const startRenaming = useRef<string | null>(null);
  const focusInput = useFocusOnMount();

  // The scene is the source. The tree is rebuilt only when the scene itself changed, not for a selection, and an
  // object that becomes the active one has what it is listed under opened so it can be seen.
  useEffect(() => {
    if (!scene) return undefined;
    let version = -1;
    let tree = EMPTY_TREE;
    let active: string | null = null;
    const sync = () => {
      if (scene.version !== version) {
        version = scene.version;
        tree = buildSceneTree(scene.outline(), scene.collections());
      }
      const selected = scene.selectedIds;
      setModel((previous) => (previous.tree === tree && previous.selected === selected ? previous : { tree, selected }));
      if (scene.selection !== active) {
        active = scene.selection;
        if (active !== null) {
          const open = active;
          setChosenRow(null);
          setCollapsed((current) => revealed(tree, current, open));
        }
      }
      const wanted = startRenaming.current;
      if (wanted !== null) {
        const target = rowTarget(wanted);
        const made = target.kind === "collection" ? tree.collections.get(target.id) : undefined;
        if (made) {
          startRenaming.current = null;
          cancelled.current = false;
          setEditing({ id: wanted, draft: made.name });
        }
      }
    };
    sync();
    return scene.onChange(sync);
  }, [scene]);

  const { tree, selected } = model;
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const active = selected[selected.length - 1] ?? null;
  const locked = !scene || disabled || busy || scene.requiresRecovery;
  const viewport = Math.min(rows.length * ROW_HEIGHT, MAX_LIST_HEIGHT);
  const range = visibleRange(scrollTop, viewport, ROW_HEIGHT, rows.length);
  const shown = rows.slice(range.start, range.end);
  const tabStop = active !== null && rows.some((row) => row.id === active) ? active : (chosenRow ?? rows[0]?.id);

  const run = useCallback(
    (commands: readonly unknown[]) => {
      if (!scene) return;
      setBusy(true);
      setError("");
      saves.run(
        async () => {
          try {
            await saveManualCommands(scene, commands);
          } finally {
            setBusy(false);
          }
        },
        (failure) => setError(errorMessage(failure)),
      );
    },
    [scene, saves],
  );

  const { drag, start, wasDrag } = useRowDrag({
    disabled: locked || editing !== null,
    canDrop: (id, target) => dropAction(tree, id, target) !== undefined,
    onDrop: (id, target) => {
      const action = dropAction(tree, id, target);
      if (!action) return;
      run(dropCommands(action));
      // What was moved stays in view: the line it was dropped on opens.
      if (target !== null) setCollapsed((current) => (current.has(target) ? without(current, target) : current));
    },
  });
  const dragging = drag ? rowTarget(drag.id).kind : null;

  // Bring the chosen line into view once when it changes, and keep keyboard focus on it when it was moved by keys.
  // Focus waits until its line is drawn, which scrolling may have only just made so.
  useEffect(() => {
    const focused = active ?? chosenRow;
    if (focused === null) {
      scrolledTo.current = null;
      return;
    }
    const list = listRef.current;
    const index = rows.findIndex((row) => row.id === focused);
    if (list && index >= 0 && scrolledTo.current !== focused) {
      scrolledTo.current = focused;
      list.scrollTop = scrollToRow(list.scrollTop, viewport, ROW_HEIGHT, index);
    }
    if (keyboardMoved.current && index >= range.start && index < range.end) {
      const line = list?.querySelector<HTMLElement>(`[${ROW_ATTRIBUTE}="${CSS.escape(focused)}"]`);
      if (line) {
        keyboardMoved.current = false;
        line.focus({ preventScroll: true });
      }
    }
  }, [active, chosenRow, rows, viewport, range.start, range.end]);

  function toggleCollapsed(id: string) {
    setCollapsed((current) => (current.has(id) ? without(current, id) : new Set(current).add(id)));
  }

  /** Chooses a line: an object is selected in the scene, a collection or the scene itself is chosen here. */
  function choose(row: TreeRow) {
    if (!scene) return;
    const target = rowTarget(row.id);
    if (target.kind === "object") {
      setChosenRow(null);
      scene.select(target.id);
    } else {
      scene.select(null);
      setChosenRow(row.id);
    }
  }

  function click(event: MouseEvent, row: TreeRow) {
    if (!scene || wasDrag()) return;
    const target = rowTarget(row.id);
    if (target.kind === "object" && event.shiftKey) {
      const anchor = selectionAnchor.current ?? scene.selection;
      const ids = anchor === null ? [] : objectRange(rows, anchor, row.id);
      if (ids.length) scene.selectMany(ids);
      else { scene.select(target.id); selectionAnchor.current = target.id; }
    } else {
      if (target.kind === "object" && (event.ctrlKey || event.metaKey)) scene.toggleSelection(target.id);
      else choose(row);
      selectionAnchor.current = target.kind === "object" ? target.id : null;
    }
  }

  function changeVisibility(action: "selected" | "unselected" | "reveal") {
    if (!scene) return;
    const protectedIds = new Set(selected);
    for (const id of selected) {
      for (let parent = tree.parents.get(id); parent; parent = tree.parents.get(parent)) protectedIds.add(parent);
    }
    const commands: unknown[] = [...tree.entries.values()]
      .filter((entry) => action === "reveal" ? !entry.visible : entry.visible && (action === "selected" ? selectedSet.has(entry.id) : !protectedIds.has(entry.id)))
      .map((entry) => outlineCommands.show(entry.id, action === "reveal"));
    if (action === "reveal") for (const collection of tree.collections.values()) if (!collection.visible) commands.push(outlineCommands.showCollection(collection.id, true));
    if (!commands.length) return;
    if (commands.length > MAX_COMMANDS_PER_PROPOSAL) { setError(`Change at most ${MAX_COMMANDS_PER_PROPOSAL} visibility settings at once.`); return; }
    run(commands);
  }

  function makeCollection() {
    if (locked || !scene) return;
    const inside = chosenRow === null ? null : rowTarget(chosenRow);
    const parent = inside?.kind === "collection" ? inside.id : null;
    const id = `col_${crypto.randomUUID()}`;
    startRenaming.current = collectionRowId(id);
    scene.select(null);
    setChosenRow(collectionRowId(id));
    // Its parent opens, so the new line is there to be named.
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(ROOT_ROW_ID);
      if (parent !== null) next.delete(collectionRowId(parent));
      return next;
    });
    run([outlineCommands.makeCollection(id, "Collection", parent)]);
  }

  function beginRename(row: TreeRow) {
    if (locked || row.kind === "root") return;
    cancelled.current = false;
    setEditing({ id: row.id, draft: row.name });
  }

  function finishRename(row: TreeRow) {
    const name = editing?.id === row.id ? editing.draft.trim() : row.name;
    setEditing(null);
    if (cancelled.current || name.length === 0 || name === row.name) return;
    const target = rowTarget(row.id);
    if (target.kind === "collection") run([outlineCommands.renameCollection(target.id, name)]);
    else if (target.kind === "object") run([outlineCommands.rename(target.id, name)]);
  }

  function renameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      cancelled.current = true;
      setEditing(null);
    }
    event.stopPropagation();
  }

  function removeCollection(row: TreeRow) {
    const target = rowTarget(row.id);
    if (locked || target.kind !== "collection") return;
    setChosenRow(null);
    run([outlineCommands.deleteCollection(target.id)]);
  }

  function toggleShown(row: TreeRow) {
    const target = rowTarget(row.id);
    if (target.kind === "collection") run([outlineCommands.showCollection(target.id, !row.visible)]);
    else if (target.kind === "object") run([outlineCommands.show(target.id, !row.visible)]);
  }

  function rowKey(event: KeyboardEvent, row: TreeRow, index: number) {
    if (!scene || event.target !== event.currentTarget) return;
    const go = (to: number) => {
      const next = rows[to];
      if (!next) return;
      keyboardMoved.current = true;
      choose(next);
    };
    switch (event.key) {
      case "ArrowDown": go(index + 1); break;
      case "ArrowUp": go(index - 1); break;
      case "ArrowRight":
        if (row.hasChildren && row.collapsed) toggleCollapsed(row.id);
        else if (row.hasChildren) go(index + 1);
        break;
      case "ArrowLeft":
        if (row.hasChildren && !row.collapsed) toggleCollapsed(row.id);
        else {
          const above = tree.displayParent.get(row.id);
          const at = above === undefined ? -1 : rows.findIndex((candidate) => candidate.id === above);
          if (at >= 0) go(at);
        }
        break;
      case "Home": go(0); break;
      case "End": go(rows.length - 1); break;
      case "Enter":
      case " ":
        choose(row);
        break;
      case "F2": beginRename(row); break;
      case "Delete":
        if (row.kind !== "collection") return;
        removeCollection(row);
        break;
      default: return;
    }
    event.preventDefault();
  }

  return (
    <section aria-label="Scene objects" className="rounded-xl border border-border bg-card/95 p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="flex-1 text-xs font-medium">Scene</h2>
        <span className="text-[11px] text-muted-foreground">{selected.length ? `${selected.length} selected / ` : ""}{tree.entries.size}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="size-6" aria-label="Scene visibility actions" disabled={locked}><Ellipsis className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!selected.length} onSelect={() => changeVisibility("selected")}>Hide selected</DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.length} onSelect={() => changeVisibility("unselected")}>Hide unselected</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => changeVisibility("reveal")}>Reveal all</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 [&_svg]:size-3.5"
          aria-label="New collection"
          title={chosenRow !== null && rowTarget(chosenRow).kind === "collection" ? "New collection inside the chosen one" : "New collection"}
          disabled={locked}
          onClick={makeCollection}
        >
          <FolderPlus />
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-xs leading-5 text-muted-foreground">Objects you create or import will appear here.</p>
      ) : (
        <div
          ref={listRef}
          role="tree"
          aria-label="Scene objects"
          aria-multiselectable="true"
          {...{ [LIST_ATTRIBUTE]: "" }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="overflow-y-auto rounded-md"
          style={{ height: viewport }}
        >
          <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
            {shown.map((row, offset) => {
              const index = range.start + offset;
              const isRoot = row.kind === "root";
              const isCollection = row.kind === "collection";
              const isSelected = isCollection || isRoot ? chosenRow === row.id : selectedSet.has(row.id);
              const Icon = isRoot ? Layers3 : isCollection ? (row.hasChildren && !row.collapsed ? FolderOpen : Folder) : row.kind === "mesh" ? Box : Group;
              const hiddenAbove = row.visible && !row.effectiveVisible;
              return (
                <div
                  key={row.id}
                  role="treeitem"
                  tabIndex={row.id === tabStop ? 0 : -1}
                  aria-level={row.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={row.hasChildren ? !row.collapsed : undefined}
                  {...{ [ROW_ATTRIBUTE]: row.id }}
                  onPointerDown={isRoot ? undefined : start(row.id)}
                  onClick={(event) => click(event, row)}
                  onKeyDown={(event) => rowKey(event, row, index)}
                  className={cn(
                    "group absolute inset-x-0 flex touch-none items-center rounded-md pr-1 text-xs select-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
                    isSelected && "bg-accent",
                    row.id === active && selected.length > 1 && "ring-1 ring-inset ring-ring",
                    (isCollection || isRoot) && "font-medium",
                    drag?.id === row.id && "opacity-50",
                    drag?.target === row.id && "bg-accent ring-1 ring-brand",
                    !row.effectiveVisible && "text-muted-foreground",
                  )}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 4 + row.depth * INDENT }}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${row.name || row.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapsed(row.id);
                      }}
                    >
                      {row.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                  ) : (
                    <span className="size-5 shrink-0" aria-hidden="true" />
                  )}
                  <Icon className="mr-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {editing?.id === row.id ? (
                    <Input
                      ref={focusInput}
                      value={editing.draft}
                      maxLength={80}
                      aria-label={`Name of ${row.name || row.id}`}
                      className="h-6 min-w-0 flex-1 px-1 text-xs md:text-xs"
                      onChange={(event) => setEditing({ id: row.id, draft: event.target.value })}
                      onKeyDown={renameKey}
                      onBlur={() => finishRename(row)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate" title={row.name || row.id} onDoubleClick={() => beginRename(row)}>
                      {row.name || row.id}
                    </span>
                  )}
                  {isCollection && !row.hasChildren && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0 [&_svg]:size-3.5"
                      aria-label={`Delete collection ${row.name || row.id}`}
                      title="Delete this empty collection"
                      disabled={locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeCollection(row);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                  {!isRoot && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={cn("size-6 shrink-0 [&_svg]:size-3.5", hiddenAbove && "opacity-40")}
                      aria-label={`${row.visible ? "Hide" : "Show"} ${row.name || row.id}`}
                      title={hiddenAbove ? "Hidden by a parent object or collection" : row.visible ? "Hide" : "Show"}
                      disabled={locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleShown(row);
                      }}
                    >
                      {row.visible ? <Eye /> : <EyeOff />}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {dragging === "object" && (
        <div
          {...{ [LIST_ATTRIBUTE]: "" }}
          className={cn(
            "mt-1 flex h-6 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground",
            drag?.target === null && "border-brand text-foreground",
          )}
        >
          Drop here to take it out of its parent
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

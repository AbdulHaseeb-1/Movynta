import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Box, ChevronDown, ChevronRight, Eye, EyeOff, Group, Layers3 } from "lucide-react";
import type { EditorScene } from "@/features/assistant";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { errorMessage, type SerialQueue } from "@/lib";
import { buildSceneTree, canMoveUnder, flattenTree, outlineCommands, revealed, scrollToRow, visibleRange, type SceneTree, type TreeRow } from "./sceneTree";
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
 * The scene's objects as a tree: parents with their children below them, a line for each object that can be
 * selected, shown or hidden, renamed (double click or F2) and moved under another object by dragging. Every
 * change is saved as the same command the assistant would propose. Only the lines in view are drawn.
 */
export function SceneOutliner({ scene, saves, disabled }: SceneOutlinerProps) {
  const [model, setModel] = useState<Model>({ tree: EMPTY_TREE, selected: NO_SELECTION });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const scrolledTo = useRef<string | null>(null);
  const keyboardMoved = useRef(false);
  const focusInput = useFocusOnMount();

  // The scene is the source. The tree is rebuilt only when the scene itself changed, not for a selection, and an
  // object that becomes the active one has its parents opened so it can be seen.
  useEffect(() => {
    if (!scene) return undefined;
    let version = -1;
    let tree = EMPTY_TREE;
    let active: string | null = null;
    const sync = () => {
      if (scene.version !== version) {
        version = scene.version;
        tree = buildSceneTree(scene.outline());
      }
      const selected = scene.selectedIds;
      setModel((previous) => (previous.tree === tree && previous.selected === selected ? previous : { tree, selected }));
      if (scene.selection !== active) {
        active = scene.selection;
        if (active !== null) {
          const open = active;
          setCollapsed((current) => revealed(tree, current, open));
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
  const tabStop = active !== null && rows.some((row) => row.id === active) ? active : rows[0]?.id;

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
    canDrop: (id, target) => canMoveUnder(tree, id, target),
    onDrop: (id, target) => {
      run([outlineCommands.move(id, target)]);
      // The object that was moved stays in view: its new parent opens.
      if (target !== null) setCollapsed((current) => (current.has(target) ? without(current, target) : current));
    },
  });

  // Bring the active object into view once when it changes, and keep keyboard focus on it when it was moved by keys.
  // Focus waits until its line is drawn, which scrolling may have only just made so.
  useEffect(() => {
    if (active === null) {
      scrolledTo.current = null;
      return;
    }
    const list = listRef.current;
    const index = rows.findIndex((row) => row.id === active);
    if (list && index >= 0 && scrolledTo.current !== active) {
      scrolledTo.current = active;
      list.scrollTop = scrollToRow(list.scrollTop, viewport, ROW_HEIGHT, index);
    }
    if (keyboardMoved.current && index >= range.start && index < range.end) {
      const line = list?.querySelector<HTMLElement>(`[${ROW_ATTRIBUTE}="${CSS.escape(active)}"]`);
      if (line) {
        keyboardMoved.current = false;
        line.focus({ preventScroll: true });
      }
    }
  }, [active, rows, viewport, range.start, range.end]);

  function toggleCollapsed(id: string) {
    setCollapsed((current) => (current.has(id) ? without(current, id) : new Set(current).add(id)));
  }

  function choose(event: MouseEvent, id: string) {
    if (!scene || wasDrag()) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) scene.toggleSelection(id);
    else scene.select(id);
  }

  function beginRename(row: TreeRow) {
    if (locked) return;
    cancelled.current = false;
    setEditing({ id: row.id, draft: row.name });
  }

  function finishRename(row: TreeRow) {
    const name = editing?.id === row.id ? editing.draft.trim() : row.name;
    setEditing(null);
    if (cancelled.current || name.length === 0 || name === row.name) return;
    run([outlineCommands.rename(row.id, name)]);
  }

  function renameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      cancelled.current = true;
      setEditing(null);
    }
    event.stopPropagation();
  }

  function rowKey(event: KeyboardEvent, row: TreeRow, index: number) {
    if (!scene || event.target !== event.currentTarget) return;
    const go = (to: number) => {
      const next = rows[to];
      if (!next) return;
      keyboardMoved.current = true;
      scene.select(next.id);
    };
    switch (event.key) {
      case "ArrowDown": go(index + 1); break;
      case "ArrowUp": go(index - 1); break;
      case "ArrowRight":
        if (row.hasChildren && row.collapsed) toggleCollapsed(row.id);
        else go(index + 1);
        break;
      case "ArrowLeft":
        if (row.hasChildren && !row.collapsed) toggleCollapsed(row.id);
        else {
          const parent = tree.parents.get(row.id);
          const at = parent === null || parent === undefined ? -1 : rows.findIndex((candidate) => candidate.id === parent);
          if (at >= 0) go(at);
        }
        break;
      case "Home": go(0); break;
      case "End": go(rows.length - 1); break;
      case "Enter":
      case " ":
        scene.select(row.id);
        break;
      case "F2": beginRename(row); break;
      default: return;
    }
    event.preventDefault();
  }

  return (
    <section aria-label="Scene objects" className="rounded-xl border border-border bg-card/95 p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <Layers3 className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="flex-1 text-xs font-medium">Scene</h2>
        <span className="text-[11px] text-muted-foreground">{tree.entries.size}</span>
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
              const isSelected = selectedSet.has(row.id);
              const Icon = row.kind === "mesh" ? Box : Group;
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
                  onPointerDown={start(row.id)}
                  onClick={(event) => choose(event, row.id)}
                  onKeyDown={(event) => rowKey(event, row, index)}
                  className={cn(
                    "absolute inset-x-0 flex touch-none items-center rounded-md pr-1 text-xs select-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
                    isSelected && "bg-accent",
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    className={cn("size-6 shrink-0 [&_svg]:size-3.5", hiddenAbove && "opacity-40")}
                    aria-label={`${row.visible ? "Hide" : "Show"} ${row.name || row.id}`}
                    title={hiddenAbove ? "Hidden because an object above it is hidden" : row.visible ? "Hide object" : "Show object"}
                    disabled={locked}
                    onClick={(event) => {
                      event.stopPropagation();
                      run([outlineCommands.show(row.id, !row.visible)]);
                    }}
                  >
                    {row.visible ? <Eye /> : <EyeOff />}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {drag && (
        <div
          {...{ [LIST_ATTRIBUTE]: "" }}
          className={cn(
            "mt-1 flex h-6 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground",
            drag.target === null && "border-brand text-foreground",
          )}
        >
          Drop here for the top level
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

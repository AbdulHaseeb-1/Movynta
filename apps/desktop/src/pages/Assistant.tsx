import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Ruler, SlidersHorizontal, Wrench } from "lucide-react";
import { MeasurementPanel } from "@/features/measurements";
import { Link, useNavigate, useParams } from "react-router";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  CoordinateViewport,
  ViewportToolbar,
  type Viewport,
} from "@/features/viewport3d";
import {
  ASSISTANT_NAME,
  AssistantPanel,
  Composer,
  EditorScene,
  LOGO_SRC,
  PromptSuggestions,
  useAssistantRun,
  UNSAVED_PROJECT_ID,
  type SceneStep,
} from "@/features/assistant";
import {
  ImportButton,
  loadSavedModel,
  useModelImport,
} from "@/features/importer";
import {
  ObjectEditingOverlay,
  ModifierPanel,
  ToolHint,
  useObjectEditing,
} from "@/features/objectEditing";
import { useViewCapture } from "@/features/viewCapture";
import { createSerialQueue } from "@/lib";
import {
  createProject,
  getProject,
  getProjectConversation,
  getProjectScene,
  ProjectBar,
  ProjectDialogs,
  projectChanged,
  projectPath,
  updateProject,
  useProjectActions,
  type Project,
  type ProjectConversation,
} from "@/features/projects";
import { errorMessage } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { AddShapeMenu, ComponentToolbar, useComponentSelection, useDesignFocus, useExtrude, DesignModeMenu, DesignWorkspacePanel, setDesignMode, setPanelOpen as setWorkspacePanelOpen } from "@/features/designWorkspace";

/** A saved project, fetched in full before the workspace shows it. */
interface SavedProject {
  project: Project;
  conversation: ProjectConversation;
  steps: SceneStep[];
}

type OpeningState = "loading" | "ready" | "error";

interface WorkspaceProps {
  /** The project to open, or undefined for a blank workspace whose project is made on the first prompt. */
  openProjectId: string | undefined;
  /** Called once, when the first prompt creates the project. */
  onProjectCreated: (projectId: string) => void;
}

function StudioWorkspace({ openProjectId, onProjectCreated }: WorkspaceProps) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const designMode = useAppSelector((state) => state.designWorkspace.mode);
  const [prompt, setPrompt] = useState("");
  const [modifierBusy, setModifierBusy] = useState(false);
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [measurementPicking, setMeasurementPicking] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const panelOpen = useAppSelector((state) => state.designWorkspace.panels.assistant);
  const setPanelOpen = useCallback((open: boolean) => dispatch(setWorkspacePanelOpen({ id: "assistant", open })), [dispatch]);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [editorScene, setEditorScene] = useState<EditorScene | null>(null);
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [opening, setOpening] = useState<OpeningState>(
    openProjectId ? "loading" : "ready",
  );
  const [openError, setOpenError] = useState("");
  const loading = useRef(0);
  const editorRef = useRef<EditorScene | null>(null);
  const projectRef = useRef<Project | undefined>(undefined);
  const saved = useRef<SavedProject | null>(null);
  const restored = useRef(false);

  const ensureProject = useCallback(async () => {
    if (projectRef.current) return projectRef.current.id;
    const created = await createProject("design");
    projectRef.current = created;
    setProject(created);
    onProjectCreated(created.id);
    return created.id;
  }, [onProjectCreated]);

  // The assistant looks at the scene through the same viewport the user sees, from any point of view.
  const viewCapture = useViewCapture(viewport, editorRef);
  const [saves] = useState(createSerialQueue);
  const run = useAssistantRun(editorRef, ensureProject, viewCapture, saves.flush);
  const hydrate = useRef(run.hydrate);
  useEffect(() => {
    hydrate.current = run.hydrate;
  });

  // Moving objects saves to the same project, so they share one line of saves.
  const editing = useObjectEditing({
    viewport,
    scene: editorScene,
    disabled: run.busy || modifierBusy || opening !== "ready" || designMode === "edit" || measurementPicking,
    saves,
  });
  const extrude = useExtrude(viewport, editorScene, run.busy || modifierBusy || opening !== "ready" || measurementPicking, saves);
  useDesignFocus(editorScene);
  useComponentSelection(viewport, editorScene, run.busy || modifierBusy || opening !== "ready" || measurementPicking);

  const importer = useModelImport({
    saves,
    editor: editorRef,
    ensureProject,
    // A model is content like any prompt: the workspace leaves its blank state and offers the chat.
    onImported: () => {
      setSubmitted(true);
    },
  });

  const actions = useProjectActions({
    onChanged: (changed, action) => {
      if (action === "duplicate") {
        void navigate(projectPath(changed));
        return;
      }
      projectRef.current = changed;
      setProject(changed);
    },
    onRemoved: () => void navigate("/", { replace: true }),
  });

  /** Shows a saved project once both its data and the 3D view are ready, whichever comes last. */
  const restoreSaved = useCallback(async () => {
    const data = saved.current;
    const editor = editorRef.current;
    if (!data || !editor || restored.current) return;
    restored.current = true;
    try {
      await editor.restore(data.steps, (step) =>
        loadSavedModel(data.project.id, step),
      );
    } catch (failure) {
      setOpenError(errorMessage(failure));
      setOpening("error");
      return;
    }
    hydrate.current(data.conversation);
    const hasContent =
      data.conversation.messages.length > 0 || data.steps.length > 0;
    setSubmitted(hasContent);
    setOpening("ready");
  }, []);

  /** Fetches the saved project. An answer that arrives after a newer request, or after leaving, is dropped. */
  const fetchProject = useCallback(() => {
    if (!openProjectId) return;
    const request = ++loading.current;
    Promise.all([
      getProject(openProjectId),
      getProjectConversation(openProjectId),
      getProjectScene(openProjectId),
    ])
      .then(([loaded, conversation, scene]) => {
        if (request !== loading.current) return;
        saved.current = { project: loaded, conversation, steps: scene.steps };
        projectRef.current = loaded;
        setProject(loaded);
        void restoreSaved();
      })
      .catch((failure: unknown) => {
        if (request !== loading.current) return;
        setOpenError(errorMessage(failure));
        setOpening("error");
      });
  }, [openProjectId, restoreSaved]);

  useEffect(() => {
    fetchProject();
    return () => {
      loading.current += 1;
    };
  }, [fetchProject]);

  // Before the first prompt the view can only rotate; pan, zoom and the toolbar come after it.
  useEffect(() => {
    viewport?.setNavigationScope(submitted ? "full" : "rotate");
  }, [viewport, submitted]);

  useEffect(() => {
    viewport?.setAssistantPanelOpen(panelOpen);
  }, [viewport, panelOpen]);

  useEffect(() => {
    dispatch(setDesignMode("object"));
  }, [dispatch]);

  function handleSubmit() {
    const message = prompt.trim();
    if (!message || run.busy) return;
    setSubmitted(true);
    setPrompt("");
    // Mount the launcher first, then open on the next frame so the pane grows out of it.
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setPanelOpen(true)),
    );
    void run.submit(message);
  }

  function handleSuggestion(suggestion: string) {
    setPrompt(suggestion);
    document.getElementById("design-prompt")?.focus();
  }

  async function renameProject(target: Project, name: string) {
    const updated = await updateProject(target.id, { name });
    projectRef.current = updated;
    setProject(updated);
    dispatch(projectChanged(updated));
  }

  const composer = (variant: "hero" | "panel") => (
    <Composer
      variant={variant}
      value={prompt}
      onChange={setPrompt}
      onSubmit={handleSubmit}
      onStop={() => void run.cancel()}
      busy={run.busy}
      ready={run.ready}
    />
  );

  return (
    <main className="relative h-full overflow-hidden bg-background font-sans text-foreground">
      <CoordinateViewport
        className="absolute inset-0"
        onReady={(ready) => {
          const created = new EditorScene(
            ready.scene,
            openProjectId ?? UNSAVED_PROJECT_ID,
          );
          editorRef.current = created;
          setEditorScene(created);
          setViewport(ready);
          void restoreSaved();
        }}
      >
        {!submitted && opening === "ready" && (
          <section
            className="pointer-events-none relative w-[min(620px,calc(100vw-40px))] text-center"
            aria-label="Design prompt"
          >
            <div className="absolute right-0 bottom-full left-0 mb-[34px] flex flex-col items-center max-[600px]:mb-7">
              <img
                src={LOGO_SRC}
                alt=""
                draggable={false}
                className="mb-5 h-12 w-auto select-none max-[600px]:h-10"
              />
              <h1 className="text-[clamp(24px,3vw,30px)] leading-[1.2] font-[750] tracking-[-0.045em]">
                What do you want to design?
              </h1>
              <p className="mt-2 text-[13px] leading-[1.5] text-muted-foreground">
                Describe a character or an object and {ASSISTANT_NAME} will
                shape it in 3D.
              </p>
            </div>
            {composer("hero")}
            <div className="absolute top-full right-0 left-0 mt-4">
              <PromptSuggestions onPick={handleSuggestion} />
            </div>
          </section>
        )}
      </CoordinateViewport>
      {((submitted && designMode === "object") || (designMode === "edit" && extrude.hint !== "")) && (
        // The tools sit at the bottom of the free part of the view: clear of the chat on the left and of
        // the object's values on the right, and centered under the work.
        <div
          className={cn(
            "pointer-events-none absolute right-4 bottom-4 z-10 flex flex-col items-center gap-2 transition-[left] duration-300 motion-reduce:transition-none",
            panelOpen ? "left-[340px]" : "left-4",
          )}
        >
          {extrude.hint || editing.transformHint ? <output aria-live="off" className="pointer-events-none max-w-3xl rounded-lg bg-popover px-3 py-2 text-center text-xs text-popover-foreground shadow-xl">{extrude.hint || editing.transformHint}</output> : <ToolHint hasSelection={editing.selected !== null} />}
          {designMode === "object" && (
            <ViewportToolbar
              viewport={viewport}
              hasSelection={editing.selected !== null}
              disabled={run.busy || modifierBusy}
              onDelete={editing.requestDelete}
              orientation="horizontal"
              className="animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none"
            />
          )}
        </div>
      )}
      {submitted && (
        <AssistantPanel
          run={run}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          composer={composer("panel")}
          className="absolute top-[64px] bottom-4 left-4 z-20 animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none"
        />
      )}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <ProjectBar project={project} onAction={actions.perform} onRename={renameProject} />
        <DesignModeMenu />
        {designMode === "edit" && <ComponentToolbar scene={editorScene} saves={saves} start={extrude.start} />}
        <AddShapeMenu scene={editorScene} ensureProject={ensureProject} saves={saves} disabled={run.busy || modifierBusy || opening !== "ready"} onBusyChange={setModifierBusy} onAdded={() => setSubmitted(true)} />
      </div>
      {/* Panel launchers stay compact until opened. */}
      <div className="pointer-events-none absolute top-4 right-4 bottom-20 z-20 flex w-[272px] flex-col items-end gap-3 overflow-y-auto">
        <ImportButton
          importer={importer}
          disabled={run.busy || modifierBusy || opening !== "ready"}
          className="pointer-events-auto w-full shrink-0"
        />
        <Button variant="ghost" size="icon" className={cn("pointer-events-auto size-8 rounded-xl border border-border bg-card/95 text-muted-foreground shadow-xl", measurementOpen && "bg-accent text-foreground")} title={measurementOpen ? "Close measurements" : "Open measurements"} aria-label={measurementOpen ? "Close measurements" : "Open measurements"} aria-expanded={measurementOpen} aria-controls="measurement-panel" onClick={() => setMeasurementOpen((open) => !open)}><Ruler className="size-4" /></Button>
        {editorScene && viewport && <div id="measurement-panel" inert={!measurementOpen} className={cn("pointer-events-auto w-full shrink-0", !measurementOpen && "hidden")}>
          <MeasurementPanel key={project?.id ?? "unsaved"} scene={editorScene} viewport={viewport} projectId={project?.id} disabled={!measurementOpen || run.busy || modifierBusy || opening !== "ready"} onPickingChange={setMeasurementPicking} />
        </div>}
        <DesignWorkspacePanel scene={editorScene} saves={saves} disabled={run.busy || modifierBusy || opening !== "ready"} />
        <WorkspacePanel panelId="modifiers" label="modifiers" icon={Wrench} forceOpen={modifierBusy}>
          {editing.selected ? <ModifierPanel scene={editorScene} saves={saves} disabled={run.busy || modifierBusy || opening !== "ready"} onBusyChange={setModifierBusy} /> : <p className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">Select an object to view its modifiers.</p>}
        </WorkspacePanel>
        {designMode === "object" && <WorkspacePanel panelId="properties" label="properties" icon={SlidersHorizontal} forceOpen={Boolean(editing.error)}>
          {editing.selected || editing.error ? (
        <ObjectEditingOverlay
          editing={editing}
          disabled={run.busy || modifierBusy}
          className="w-full"
        />
          ) : <p className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">Select an object to view its properties.</p>}
        </WorkspacePanel>}
      </div>
      {opening !== "ready" && (
        <div
          role={opening === "error" ? "alert" : "status"}
          className="absolute inset-0 z-30 grid place-items-center bg-background/80 backdrop-blur-sm"
        >
          {opening === "loading" ? (
            <p className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Opening project…
            </p>
          ) : (
            <div className="flex max-w-[360px] flex-col items-center gap-4 px-6 text-center">
              <div>
                <h2 className="text-sm font-medium">
                  This project could not be opened
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {openError}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg px-4 text-[13px]"
                  onClick={() => {
                    restored.current = false;
                    saved.current = null;
                    editorRef.current?.reset();
                    setOpening("loading");
                    fetchProject();
                  }}
                >
                  Try again
                </Button>
                <Link
                  to="/"
                  className={cn(
                    buttonVariants(),
                    "h-9 rounded-lg px-4 text-[13px]",
                  )}
                >
                  Back to home
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
      <ProjectDialogs actions={actions} />
    </main>
  );
}

/**
 * The design workspace. `/studio` is a blank one; `/studio/:projectId` opens a saved project. When the
 * first prompt creates a project the address changes to its own, but the workspace stays as it is.
 */
export default function Assistant() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [instance] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<string | undefined>(undefined);

  // The address follows the project once it exists, so a reload or a link reopens it.
  useEffect(() => {
    if (created) void navigate(projectPath({ id: created, category: "design" }), { replace: true });
  }, [created, navigate]);

  const openProjectId = projectId && projectId !== created ? projectId : undefined;
  return (
    <StudioWorkspace
      key={openProjectId ?? instance}
      openProjectId={openProjectId}
      onProjectCreated={setCreated}
    />
  );
}

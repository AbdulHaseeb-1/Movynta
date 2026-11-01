import { useEffect, useRef, useState } from "react";
import { House } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
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
} from "@/features/assistant";

export default function Assistant() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const editorRef = useRef<EditorScene | null>(null);
  const projectId = useRef(`studio-${crypto.randomUUID()}`);
  const run = useAssistantRun(editorRef);

  // Before the first prompt the view can only rotate; pan, zoom and the toolbar come after it.
  useEffect(() => {
    viewport?.setNavigationScope(submitted ? "full" : "rotate");
  }, [viewport, submitted]);

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

  function handleNewChat() {
    run.reset();
    setSubmitted(false);
    setPanelOpen(false);
  }

  function handleSuggestion(suggestion: string) {
    setPrompt(suggestion);
    document.getElementById("design-prompt")?.focus();
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
          editorRef.current = new EditorScene(ready.scene, projectId.current);
          setViewport(ready);
        }}
      >
        {!submitted && (
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
      {submitted && (
        <div className="pointer-events-none absolute top-1/2 right-4 z-10 -translate-y-1/2">
          <ViewportToolbar
            viewport={viewport}
            className="animate-in fade-in slide-in-from-right-4 duration-500 motion-reduce:animate-none"
          />
        </div>
      )}
      {submitted && (
        <AssistantPanel
          run={run}
          onNewChat={handleNewChat}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          composer={composer("panel")}
          className="absolute top-[64px] bottom-4 left-4 z-20 animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-4 left-4 z-20 size-10 rounded-xl bg-black/60 text-muted-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150 hover:bg-foreground/10 hover:text-foreground"
        onClick={() => void navigate("/")}
        aria-label="Home"
        title="Home"
      >
        <House className="size-[18px]" />
      </Button>
    </main>
  );
}

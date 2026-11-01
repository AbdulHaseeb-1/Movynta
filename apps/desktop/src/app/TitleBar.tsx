import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Settings, Square, X } from "lucide-react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { SettingsDialog } from "@/features/settings";
import { cn } from "@/lib/utils";

const controlClassName =
  "grid h-9 w-[46px] cursor-pointer place-items-center hover:bg-accent focus-visible:-outline-offset-[3px] focus-visible:outline-2 focus-visible:outline-ring";

export function TitleBar() {
  if (!isTauri()) return null;

  const window = getCurrentWindow();

  return (
    <header
      className="relative z-10 flex h-9 shrink-0 bg-card font-sans text-[13px] text-foreground"
      aria-label="Window title bar"
    >
      <div
        className="flex min-w-0 flex-1 select-none items-center gap-2 pl-3"
        data-tauri-drag-region
      >
        <img
          src="/logo/movynta-silver.svg"
          alt=""
          className="h-5 w-5 object-contain"
          data-tauri-drag-region
        />
      </div>
      <div className="flex">
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={controlClassName}
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={16} strokeWidth={1.5} />
            </button>
          </DialogTrigger>
          <SettingsDialog />
        </Dialog>
        <button
          type="button"
          className={controlClassName}
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void window.minimize()}
        >
          <Minus size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className={controlClassName}
          aria-label="Maximize or restore"
          title="Maximize or restore"
          onClick={() => void window.toggleMaximize()}
        >
          <Square size={12} strokeWidth={1.4} />
        </button>
        <button
          type="button"
          className={cn(
            controlClassName,
            "hover:bg-destructive hover:text-background",
          )}
          aria-label="Close"
          title="Close"
          onClick={() => void window.close()}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

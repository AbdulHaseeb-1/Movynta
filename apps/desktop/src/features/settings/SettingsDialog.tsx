import { useState, type ComponentType } from "react";
import { Boxes, Keyboard, Settings } from "lucide-react";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProvidersSettings } from "./ProvidersSettings";
import { BackendConnection } from "./BackendConnection";
import { ControlsSettings } from "./ControlsSettings";
import { cn } from "@/lib/utils";

type SettingsTab = "general" | "providers" | "controls";
type NavigationItem = {
  id: SettingsTab;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
};

const navigation: NavigationItem[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "providers", label: "Providers", icon: Boxes },
  { id: "controls", label: "Shortcuts", icon: Keyboard },
];

export function SettingsDialog({
  initialTab = "general",
}: {
  initialTab?: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  return (
    <DialogContent className="flex h-[min(650px,calc(100vh-48px))] w-[min(960px,calc(100vw-32px))] flex-col gap-0 overflow-hidden rounded-xl p-0">
      <div className="flex h-14 shrink-0 items-center border-b px-5 pr-12">
        <DialogTitle className="text-[15px] font-semibold">
          Settings
        </DialogTitle>
      </div>
      <DialogDescription className="sr-only">
        Manage application settings, model providers, and control references.
      </DialogDescription>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings categories"
          className="w-48 shrink-0 border-r bg-card p-3 max-sm:w-16 max-sm:px-2"
        >
          <p className="px-2 pt-2 pb-3 text-[11px] text-muted-foreground max-sm:sr-only">
            Preferences
          </p>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring max-sm:justify-center max-sm:px-0",
                tab === id && "bg-accent font-medium text-foreground",
              )}
            >
              <Icon size={17} aria-hidden />
              <span className="max-sm:sr-only">{label}</span>
            </button>
          ))}
        </nav>
        <section
          aria-labelledby={
            tab === "general" ? "general-settings-heading"
              : tab === "controls" ? "controls-settings-heading" : "settings-section-heading"
          }
          className="min-w-0 flex-1 overflow-y-auto p-6 sm:p-8"
        >
          {tab === "general" && <BackendConnection />}
          {tab === "controls" && <ControlsSettings />}
          <div hidden={tab !== "providers"}>
            <ProvidersSettings />
          </div>
        </section>
      </div>
    </DialogContent>
  );
}

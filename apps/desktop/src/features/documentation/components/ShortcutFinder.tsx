import { useMemo, useState, type KeyboardEvent } from "react";
import { Keyboard } from "lucide-react";
import { Link } from "react-router";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { guidePath } from "../guideLinks";
import { chordFromEvent, chordKeys } from "../shortcuts/keys";
import { findShortcuts, shortcutGroups } from "../shortcuts/shortcutReference";

/** Keys worth trying first: each does something different depending on the mode. */
const SUGGESTIONS = ["G", "E", "Ctrl+Z", "Shift+Z", "Numpad 1", "Esc"] as const;

/**
 * An interactive lookup: focus the box and press a key or combination to see every place it does
 * something. Tab still moves focus out, so the box never traps the keyboard.
 */
export function ShortcutFinder() {
  const [chord, setChord] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const matches = useMemo(() => (chord ? findShortcuts(shortcutGroups, chord) : []), [chord]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
    const next = chordFromEvent(event);
    // Keep the browser and the app from acting on the key, so F1, Space or Ctrl+Z can be looked up safely.
    event.preventDefault();
    if (next) setChord(next);
  };

  return (
    <section aria-labelledby="shortcut-finder-heading" className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="shortcut-finder-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard aria-hidden className="size-4 text-muted-foreground" /> Key finder
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Click the box and press any key or combination to see what it does in each mode. Tab moves on.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Try a key">
          <span className="text-[11px] text-muted-foreground">Try</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setChord(suggestion)}
              className={cn(
                "rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                chord === suggestion && "bg-secondary text-foreground",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Key finder: press a key or combination to look it up"
        aria-describedby="shortcut-finder-result"
        onKeyDown={onKeyDown}
        onKeyUp={(event) => event.preventDefault()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "mt-4 flex min-h-16 w-full cursor-text items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-4 py-3 outline-none transition-colors",
          focused && "border-solid border-ring/60 bg-muted/40",
        )}
      >
        {chord ? (
          chordKeys(chord).map((key, index) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              {index > 0 && <span aria-hidden className="text-xs text-muted-foreground">+</span>}
              <Kbd className="h-7 min-w-7 px-2 text-sm">{key}</Kbd>
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{focused ? "Press a key…" : "Click here, then press a key"}</span>
        )}
      </button>

      <div id="shortcut-finder-result" aria-live="polite" className="mt-4">
        {chord && matches.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing in the workspace uses <Kbd>{chord}</Kbd>. It is free, or typed as text in a field.
          </p>
        )}
        {matches.length > 0 && (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {chord} does {matches.length === 1 ? "one thing" : `${matches.length} things, depending on the mode`}:
            </p>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {matches.map(({ group, control }) => (
                <li key={`${group.id}-${control.action}`} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                  <p className="text-[11px] text-muted-foreground">{group.name}<span className="block text-[10px] opacity-80">{group.context}</span></p>
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{control.action}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {control.detail}
                      {control.guide && (
                        <> <Link to={guidePath(control.guide)} className="whitespace-nowrap text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">Learn more</Link></>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

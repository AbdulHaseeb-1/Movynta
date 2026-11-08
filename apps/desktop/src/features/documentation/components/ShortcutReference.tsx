import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { guidePath } from "../guideLinks";
import { filterShortcutGroups, shortcutGroups } from "../shortcuts/shortcutReference";
import { KeyCombo } from "./KeyCombo";

interface ShortcutReferenceProps {
  /** Search text from the page. When given, the reference has no search field of its own. */
  readonly query?: string | undefined;
  /** The id of the heading, for a surrounding section's `aria-labelledby`. */
  readonly headingId?: string | undefined;
  /** Hides the title and description, for places that already have one. */
  readonly hideHeading?: boolean;
  /** Called after a "Learn more" link is followed, for example to close a dialog. */
  readonly onNavigate?: (() => void) | undefined;
}

const ALL = "all";

/** The searchable list of every keyboard, mouse and toolbar control, grouped by where it applies. */
export function ShortcutReference({ query, headingId, hideHeading = false, onNavigate }: ShortcutReferenceProps) {
  const [ownQuery, setOwnQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const search = query ?? ownQuery;
  const matching = useMemo(
    () => filterShortcutGroups(shortcutGroups, search, category === ALL ? undefined : category),
    [category, search],
  );
  const categories = [{ id: ALL, name: "All" }, ...shortcutGroups.map(({ id, name }) => ({ id, name }))];

  return (
    <div className="flex flex-col gap-4">
      {(!hideHeading || query === undefined) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          {!hideHeading && (
            <div>
              <h2 id={headingId} className="text-[17px] font-semibold">
                Shortcuts
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Keyboard, mouse and toolbar controls for your workspace. Press{" "}
                <KeyCombo keys="?" className="align-middle" /> on any page to open this list.
              </p>
            </div>
          )}
          {query === undefined && (
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Search shortcuts"
                placeholder={category === ALL ? "Search shortcuts or keys" : "Search this category"}
                value={ownQuery}
                onChange={(event) => setOwnQuery(event.target.value)}
                className="h-8 bg-background pl-9 text-xs"
              />
            </div>
          )}
        </div>
      )}
      <nav aria-label="Shortcut categories" className="flex flex-wrap gap-1 border-b border-border pb-2">
        {categories.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              category === id && "bg-secondary font-medium text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </nav>
      {matching.length === 0 && (
        <output className="block py-4 text-sm text-muted-foreground">No controls match your search.</output>
      )}
      {matching.map((group) => (
        <section key={group.id} aria-label={group.name}>
          <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-xs font-semibold">{group.name}</h3>
            <p className="text-[11px] text-muted-foreground">{group.context}</p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card/50">
            {group.controls.map((control) => (
              <div
                key={control.action}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.6fr)_13rem] sm:items-center"
              >
                <p className="min-w-0 text-xs font-medium">{control.action}</p>
                <KeyCombo
                  keys={control.keys}
                  className="col-start-2 row-start-1 max-w-52 justify-end sm:col-start-3 sm:max-w-none"
                />
                <p className="col-span-2 min-w-0 text-[11px] leading-4 text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {control.detail}
                  {control.guide && (
                    <>
                      {" "}
                      <Link
                        to={guidePath(control.guide)}
                        onClick={onNavigate}
                        className="inline-flex items-center gap-0.5 whitespace-nowrap text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Learn more
                        <ArrowUpRight aria-hidden className="size-3" />
                      </Link>
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

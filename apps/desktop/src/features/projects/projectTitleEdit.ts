import { errorMessage } from "@/lib/backend";

/** How an edit of the project's name ended. */
export type TitleEditOutcome =
  | { readonly kind: "unchanged" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Saves what was typed as the project's name. A name that is the same as the current one is not sent, and a
 * failure is reported, not thrown, so the title can keep the text for another try.
 */
export async function saveTitleEdit(
  draft: string,
  current: string,
  onRename: (name: string) => Promise<void>,
): Promise<TitleEditOutcome> {
  const next = draft.trim();
  if (next === current.trim()) return { kind: "unchanged" };
  try {
    await onRename(next);
    return { kind: "saved" };
  } catch (failure) {
    return { kind: "failed", message: errorMessage(failure) };
  }
}

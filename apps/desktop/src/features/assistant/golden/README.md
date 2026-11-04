# Golden histories

A project is saved as the list of command batches and imports that built its scene, and opening it replays them. So
every change to the editor has to keep old lists replaying into the same scene. These fixtures check that against
histories **recorded by older code**, not by today's.

## What is here

- `fixtures/<set>/<scenario>.json`: `{ meta, steps, expected }`. `steps` is what a project stores (commands after the
  schema filled in its defaults); `expected` is `summarize()` of the scene the **old** editor had after running them.
  `meta.commit` is the commit that recorded it.
- `scenarios.ts`: the histories. They use only the commands of the recorded commit, so one scenario can be run by old and new code.
- `summary.ts`: describes a scene for comparison (objects, places, mesh fingerprints, modifiers). It uses only the API old and new editors share.
- `compare.ts`: the comparison, and the **only** differences it allows (see below).
- `models.ts`: the imported models. A history stores that a model was imported, not the model, so fixtures name a recipe.
- `goldenReplay.test.ts`: replays every fixture with today's editor and compares. It also checks that the comparator
  catches real differences, and that today's recorder stores the same steps the fixtures hold.

## Differences that are allowed

1. **Names of siblings.** Siblings now get different names (`Part`, `Part.001`); the old editor allowed equal ones.
   A name is numbered when an object is created or renamed, or moved under a parent that has the name already, and
   keeps its number when it moves later. A name may differ only by such a number and must be unique among its siblings now.
2. **Form of a cut's part path.** A boolean modifier written with an index path (`[1]`) is stored by part name now.
   The summary writes the path as which mesh it leads to, so the two forms agree.

## What the fixtures cannot hold

- Histories where a part's position changes *after* a cut was written, so an index path would point at another part.
  The old editor retargeted the cut; today's keeps it on the part it was written for. That is the intended fix, covered by its own tests.
- Moving a model that a cut uses together with other changes in one batch. The old editor refused it (fixed since), so it has no old history.

## Adding a set

Fixtures are never refreshed from today's code; that would make them agree with whatever it does. To add a set when
the format of histories changes, check out the commit to use as the baseline (a `git worktree` works), copy this
folder and `tests/golden/record.test.ts` into it, and run there:

```
GOLDEN_RECORD=1 GOLDEN_SET=<set> GOLDEN_COMMIT=<commit> pnpm exec vitest run tests/golden
```

Then copy `fixtures/<set>` back. A scenario that today's editor must treat differently belongs in `compare.ts` as a
written difference, with a test that shows it is not hiding a real one.

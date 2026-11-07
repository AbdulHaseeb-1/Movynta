import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import type { ExampleId } from "./exampleIds";

/** Each example loads only when it is opened; the navigation example brings a WebGL viewport with it. */
const EXAMPLES: Readonly<Record<ExampleId, LazyExoticComponent<ComponentType>>> = {
  navigation: lazy(() => import("./NavigationExample").then((module) => ({ default: module.NavigationExample }))),
  transform: lazy(() => import("./TransformExample").then((module) => ({ default: module.TransformExample }))),
  selection: lazy(() => import("./SelectionExample").then((module) => ({ default: module.SelectionExample }))),
};

/** The interactive example with this id. */
export function ToolExample({ id }: { readonly id: ExampleId }) {
  const Example = EXAMPLES[id];
  return (
    <Suspense
      fallback={
        <div className="grid h-80 place-items-center rounded-xl border border-border bg-card text-xs text-muted-foreground">
          Loading example…
        </div>
      }
    >
      <Example />
    </Suspense>
  );
}

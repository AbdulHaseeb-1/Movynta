import { useState, type ComponentProps } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { projectCategories } from "./projectCategories";
import type { ProjectCategoryId } from "./projectTypes";

type NewProjectButtonProps = Omit<ComponentProps<typeof Button>, "onClick">;

/**
 * Starts a new project. With one category it goes straight to that workspace; with several it asks
 * which kind first. The project itself is created on the first prompt, not here.
 */
export function NewProjectButton({ className, children, ...props }: NewProjectButtonProps) {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<ProjectCategoryId>(projectCategories[0]?.id ?? "design");

  function open(category: ProjectCategoryId) {
    const info = projectCategories.find((item) => item.id === category);
    if (info) void navigate(info.workspacePath());
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          const only = projectCategories.length === 1 ? projectCategories[0] : undefined;
          if (only) open(only.id);
          else setPicking(true);
        }}
        className={cn("h-9 rounded-lg px-4 text-[13px]", className)}
        {...props}
      >
        {children ?? (
          <>
            <Plus className="size-4" aria-hidden="true" />
            New project
          </>
        )}
      </Button>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="z-[100] w-[min(460px,calc(100vw-32px))] p-6">
          <DialogTitle className="pr-6 text-base font-semibold">New project</DialogTitle>
          <DialogDescription className="text-xs leading-5 text-muted-foreground">
            Choose what you want to make. The project is saved when you send your first prompt.
          </DialogDescription>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Project category</legend>
            {projectCategories.map((category) => (
              <label
                key={category.id}
                aria-label={category.label}
                className={cn(
                  "flex cursor-pointer items-center gap-3.5 rounded-xl bg-foreground/[0.04] p-4 ring-1 ring-transparent transition-colors hover:bg-foreground/[0.07] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  choice === category.id && "ring-foreground/40",
                )}
              >
                <input
                  type="radio"
                  name="project-category"
                  value={category.id}
                  checked={choice === category.id}
                  onChange={() => setChoice(category.id)}
                  className="sr-only"
                />
                <category.icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{category.label}</span>
                  <span className="text-xs text-muted-foreground">{category.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPicking(false)}
              className="h-9 rounded-lg px-4 text-[13px]"
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => open(choice)} className="h-9 rounded-lg px-4 text-[13px]">
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

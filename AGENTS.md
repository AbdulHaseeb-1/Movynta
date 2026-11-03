# Agent guide

## Tech stack

- Desktop: Tauri 2, Rust, React, TypeScript, and Vite.
- State: Redux Toolkit and react-redux in the desktop app.
- Routing: react-router with hash routing in the desktop app.
- UI: shadcn/ui, Tailwind CSS, and Lucide icons.
- Backend: NestJS and TypeScript, with the OpenAI Agents SDK (`@openai/agents`) and Zod v4 schemas for agent tools.
- Package manager: pnpm workspace with a single root lockfile.

## Structure

- `apps/desktop/`: React frontend and `src-tauri/` desktop application.
  - `src/app/`: app setup, including routes (`router.tsx`), the Redux store (`store.ts`), and typed hooks (`hooks.ts`).
  - `src/pages/`: page-level components.
  - `src/features/`: feature-specific UI and logic, grouped by capability. Keep each feature's Redux slice in its folder and register it in `src/app/store.ts`.
  - `src/components/`: reusable components; `src/components/ui/` contains shadcn/ui components.
  - `src/lib/`: utilities and integrations; `src/styles/`: global styles.
- `apps/backend/`: NestJS AI backend. Group features in `src/modules/`, backend-wide utilities in `src/common/`, and shared schemas in `src/shared/`. See `apps/backend/README.md` for the architecture.
- `skills/`: agent skill packages, one folder per skill with a `SKILL.md` file. The backend loads them at startup.
- `packages/`: code shared by multiple apps. Create packages only when needed.
- `designs/`: design references and assets.

## Working rules

### UI and state

- Use shadcn/ui components and adapt their styling to the existing design.
- Colors come from the fixed palette in `apps/desktop/src/styles/index.css` (documented at the top of that file). Use theme tokens such as `bg-card`, `text-muted-foreground`, `bg-brand`, and Button/Badge variants; do not add raw hex colors.
- Define routes in `src/app/router.tsx`. Move between pages with `useNavigate` or `<Link>`, not with local page state.
- Manage shared client state with Redux Toolkit slices created with `createSlice`. Access the store through `useAppSelector` and `useAppDispatch` from `src/app/hooks.ts`.

### Code organization and design

- Organize code by feature and responsibility. Keep files focused, reuse shared logic, and avoid duplication.
- Define clear types for data, inputs, outputs, and component props in each TypeScript file as applicable. Provide an `index.ts` in each TypeScript source folder to define its public exports.
- Consider established design patterns, including Gang of Four patterns, for each feature. Apply them where they improve clarity or maintainability.
- Follow existing conventions and preserve unrelated changes.

### Backend and agents

- Keep controllers thin and put business logic in services. Keep agent instructions in agent definitions and tools in `src/modules/tools/`.
- Agents change the editor only through `editor.propose_commands` and `editor.apply_proposal`. Never send code, shell commands, or raw scene access from an agent to the editor.
- Never expose `OPENAI_API_KEY` or other server secrets to the React or Tauri frontend.
- Mock the model in automated tests (`@openai/agents/testing`). Tests must not call OpenAI.

### Assistant tools

- `docs/assistant-tools.md` is the inventory of every tool the assistant can call, the editor commands they accept, and the approval rules. Keep it current.
- Update that file in the same change whenever you add, rename, remove, or alter a tool: its name, description, permission, parameters, approval rule, or the editor commands it accepts. Also update it when a skill's `tools:` list changes.
- Steps for a tool change:
  1. Define or change the tool with `defineTool` in `apps/backend/src/modules/tools/<area>/`. Names are `namespace.snake_case`.
  2. Register a new tool in the factory in `apps/backend/src/modules/tools/tools.module.ts`.
  3. Update the tool table, the approval notes, and the command table in `docs/assistant-tools.md`. If the command schema in `packages/editor-protocol` changed, also update the desktop handling in `apps/desktop/src/features/assistant/EditorScene.ts`.
  4. Update the tests in `apps/backend/src/modules/tools/` and any skill `tools:` lists in `skills/` that name the tool.
  5. Update the base instructions in `modeling-coordinator.instructions.ts` if the model needs to know about the change.
  6. Run `pnpm check` and the backend tests before finishing.

### Types and checks

- Keep TypeScript strict. The compiler options in `apps/desktop/tsconfig.json` and `apps/desktop/tsconfig.node.json` must stay enabled; do not weaken them.
- Do not use `any`, `@ts-ignore`, or non-null assertions (`!`). Narrow types or validate values instead.
- Run `pnpm check` (typecheck and oxlint) from the repo root before finishing a change, and fix every error it reports.

### Performance and validation

- Choose appropriate data structures and algorithms for complex or performance-critical work.
- Benchmark computationally heavy functions when adding or changing them, and optimize measured bottlenecks.
- Run checks relevant to the changes, and report any checks or benchmarks that could not be run.

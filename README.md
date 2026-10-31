# Movynta

A desktop application built with Tauri, React, TypeScript, Vite, Tailwind CSS, and shadcn/ui, with a NestJS backend.

## Structure

- `apps/desktop` — React frontend and Tauri application.
- `apps/backend` — NestJS backend.
- `designs` — design references.

## Development

Install Node.js, pnpm, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run from the repository root:

```sh
pnpm install
pnpm tauri dev
```

Use `pnpm dev` for the frontend alone and `pnpm dev:backend` for the backend. The backend listens on `127.0.0.1:3000` by default; set `PORT` to choose another port. Run `pnpm build` to build both apps, or use `pnpm build:desktop` and `pnpm build:backend` individually. Package the desktop app with `pnpm tauri build`.

Add shadcn components from `apps/desktop` with `pnpm dlx shadcn@latest add button`.

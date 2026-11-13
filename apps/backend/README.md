# Movynta AI backend

NestJS orchestration layer for Movynta's AI modeling features. It runs OpenAI Agents SDK agents for 3D work, and brokers every change to the editor through validated, approved commands. The desktop app never receives keys, code, or raw scene access from the agent.

## Setup (Windows desktop)

From the repository root, run `pnpm dev:backend` and then `pnpm tauri dev` in another terminal. The desktop automatically authenticates with the running local backend; there is no access-token field. The backend listens only on `127.0.0.1:3001`.

Open Settings > Providers to configure OpenAI, Anthropic, Google, OpenAI-compatible, or Anthropic-compatible providers. Enter a key, load models using the plus button, select or type a model ID, test access, and save. Select the provider's radio button to make it active. All provider requests originate on the backend. Compatible providers accept an HTTPS API base URL (or HTTP on localhost), usually ending in `/v1`. OpenAI compatibility uses Chat Completions; Anthropic compatibility uses Messages. Model loading uses the endpoint's `/models` resource; you can enter a model ID manually if the service does not expose it. Re-enter the key when changing a saved endpoint. Compatible providers also have a **Send pictures** switch: turn it off when the endpoint's model cannot read images, and the assistant then checks the scene from measurements alone.

**ChatGPT subscription.** Settings > Providers > ChatGPT signs in with a ChatGPT plan instead of an API key. The backend runs the browser OAuth (PKCE) flow: it listens briefly on `127.0.0.1:1455` for the redirect, exchanges the code, and stores the tokens only as DPAPI ciphertext in `chatgpt_logins`. Tokens refresh automatically, but a sign-in stops working 30 days after it was made (`CHATGPT_LOGIN_TTL_MS`); the tokens are then wiped and the user signs in again. Routes: `GET /providers/chatgpt/session`, `POST /providers/chatgpt/login`, `DELETE /providers/chatgpt/login` (cancel), and `DELETE /providers/chatgpt` (sign out). Requests go to `chatgpt.com/backend-api/codex` with `store: false`. This uses the sign-in client of OpenAI's Codex CLI and is intended for local, personal use.

A `.env` file is optional. By default the backend creates its authentication signing secret and database under `%LOCALAPPDATA%/Movynta`. The signing secret and desktop connection record use Windows DPAPI CurrentUser encryption. Provider keys are stored only as DPAPI ciphertext in SQLite, scoped to the API user and provider. `DATABASE_URL` can override the database path. The old token CLI remains available for advanced authenticated API clients.

See [the integration and security report](../../docs/assistant-integration-report.md) for verification and limitations.

## Checks

```bash
pnpm --filter movynta-backend typecheck   # strict compile, incl. the spec files
pnpm --filter movynta-backend lint        # oxlint with type-aware rules
pnpm --filter movynta-backend test        # unit and integration tests (no network)
pnpm --filter movynta-backend check       # typecheck + lint
```

Tests run the real application against an in-memory SQLite database. The OpenAI model is replaced by the SDK's scripted model (`@openai/agents/testing`), and the editor is a simulated WebSocket client. No test calls OpenAI.

## Architecture

```
src/
  main.ts, app.module.ts          bootstrap and composition root
  config/                         Zod-validated environment and typed AppConfig
  common/                         errors, request IDs, auth decorators, bootstrap, pipes
  modules/
    auth/                         HMAC bearer tokens, global guard
    persistence/                  node:sqlite connection and versioned migrations
    projects/                     project ownership (claim on first use)
    sessions/                     private sessions; SQLite-backed SDK Session
    skills/                       SKILL.md parser, safe loader, relevance selection
    tools/                        ToolRegistry, Zod-typed tools, SDK tool() adapter
    agents/                       AgentRegistry, Runner provider, ModelingCoordinatorAgent
    providers/                    provider configuration, DPAPI vault, vendor model adapters
    agent-runs/                   run state machine, processor, events, SSE, service
    approvals/                    approval policy, one-time decisions
    editor-bridge/                EditorBridge, WebSocket gateway, command proposals
    mcp/                          MCP server registry (off by default, default-deny tools)
    blender/                      worker interface; disabled implementation
  shared/                         Zod schemas for editor commands, context, plans
  testing/                        harness, editor simulator, SSE reader (tests only)
skills/                           repository skills: character-modeling, mesh-editing,
                                  model-design-principles,
                                  props-hard-surface, topology-and-subdivision,
                                  pbr-materials-and-color
```

### Modeling workflow

Current desktops prepare assistant edits in an isolated candidate, commit accepted commands and proposal status together, then display the candidate. Saved-but-undelivered changes are restored when the editor reconnects, and the desktop checks for them at run completion. A failed prepare or failed database commit does not change the displayed scene. Older editor clients use the legacy execution path.

Project history supports durable undo/redo for manual edits, deletion, imports, geometry and assistant runs. The desktop previews history, loads all required assets, commits with an optimistic version and idempotency key, then replaces the displayed scene. Ctrl/Cmd+Z undoes an action; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it. Adjacent proposals from one assistant run and batches from one manual gesture form an action. New work abandons redo. Source assets remain stored for replay. Large histories need a full replay; checkpoints and a visual history panel are not implemented.

The assistant can inspect paged mesh topology and live stacks with `editor.inspect_mesh`, append `geometry.bevel` or `geometry.subdivide`, edit or clear the stack with `geometry.set_modifiers`, and extrude a base-cage region with `geometry.extrude`. Bevel supports 1–8 segments, a chamfer or round profile, an angle limit, and concave/open manifold geometry. Subdivision uses 1–3 levels of Catmull–Clark (default), Linear or Loop. UVs, material groups, skinning, morph targets and vertex colors are interpolated. Changes use approval, isolated preparation and saved-history replay. Full parameters and limits are in [assistant tools](../../docs/assistant-tools.md#mesh-inspection-and-surface-operations).

For procedural layouts, the assistant can call `modeling.generate_commands`: bounded synchronous JavaScript runs in a fresh QuickJS WebAssembly runtime against a JSON scene snapshot. It returns validated command arrays; source is never sent to the editor. The assistant then proposes those commands with `expectedRevision: sourceRevision` and applies them through the normal approval flow. Such proposals fail on revision changes rather than rebasing calculated positions. Limits, API examples and remaining limitations are in [assistant tools](../../docs/assistant-tools.md#procedural-programs).

1. A client creates a run with `POST /api/v1/agent-runs` and receives `runId` and `eventsUrl`. The request may carry up to 8 reference pictures (see [images attached by the user](../../docs/assistant-tools.md#images-attached-by-the-user)); they go to the model with that request, and the newest of them stay in the chat's stored history for later messages (their names are always kept).
2. The service selects at most two relevant skills for the request. Only their names and descriptions go into the prompt. The agent loads a full workflow with `skills.load_skill`, which refuses any skill not selected for the request.
3. The agent reads the scene through `editor.get_context`. This is a request to the editor over the WebSocket bridge, answered only by the connection that owns the run.
4. The agent records a plan with `modeling.generate_model_plan` (step tools must exist in the registry).
5. The agent submits structured commands with `editor.propose_commands`. The batch is checked against the latest scene revision, and object references must exist. The editor receives the proposal for preview.
6. `editor.apply_proposal` executes a proposal. Deletions, replacements, and batches over 20 commands need approval. The run pauses with `approval.required`, and the serialized SDK state stays on the server.
7. `POST /agent-runs/:runId/approvals/:approvalId` records the decision once. When every pending approval is decided, the run resumes from the stored state with those decisions.
8. The editor executes the approved commands and reports results. Each proposal runs at most once, keyed by its id and checked against the base revision.
9. The agent validates the scene with `validation.check_scene` and responds. The full history is stored in the session.

A reply ends the run only when the work is finished. After each turn the run checks its own progress (`run-progress.ts`): every scene step of the latest plan that names a `stepId` has an applied batch, no batch waits unapplied, and the last scene check reported no errors after the last change. If something is open, the run sends the model a continuation message that lists it and emits `agent.continued`. A recorded brief must also have been measured on the final scene and pass (see [assistant tools](../../docs/assistant-tools.md#brief-and-measured-checks)). Once the builder has nothing left open, requests that call for it (`AGENT_REVIEW_MODE`: `quality` by default, `builds` for every 3D build, `off` for none) are examined by a separate, internal `quality-reviewer` agent with fresh context and read-only tools; its findings come back to the builder as work, up to `AGENT_REVIEW_LIMIT` reviews (see [independent review](../../docs/assistant-tools.md#independent-review)). The builder does not have the verdict tool, so it cannot grade its own work. The reviewer is a fallible judgment, not an objective quality guarantee. This repeats up to `AGENT_CONTINUATION_LIMIT` times (5 by default), after which the last reply is accepted. A continuation that answers without a tool call ends the run with that reply, so a question for the user is not repeated.

Time limits are separate. `AGENT_RUN_IDLE_TIMEOUT_MS` (5 minutes by default) stops a run that has shown no progress, and the run then fails with `run_stalled`. `AGENT_RUN_TIMEOUT_MS` (2 hours by default) caps the active time of one run. Both clocks pause while a run waits for an approval.

### Streaming

Events use the envelope `{ id, runId, type, timestamp, payload }`. The SSE `id` is the event sequence number, so `Last-Event-ID` resumes a stream after a reconnect. Events are persisted before they are published, and the stream removes duplicates that arrive during replay. A heartbeat is sent every 15 seconds. Reasoning content, provider keys, and tool arguments are never included.

### Editor protocol

Connect to `/api/v1/editor/ws`. The first message must authenticate within 10 seconds:

```json
{ "event": "auth", "data": { "token": "...", "projectId": "..." } }
```

The server replies with `auth.ok` and a `clientId`, which the client passes as `editorClientId` when creating a run. The server then sends `context.request`, `proposal.created`, and `commands.execute`. The client answers with `context.response`, `context.error`, and `commands.result`. Commands are a closed union of typed operations. Raw code is rejected by the schema.

### Security

- Bearer tokens are HMAC-SHA256 signed with a constant-time comparison and an expiry.
- Sessions, runs, approvals, and proposals are owned by a single user. Other users receive 404, and projects return 403.
- Skill loading is confined to the skills directory. Folder names are validated, symlink escapes are rejected, and only `SKILL.md` is read.
- Tool arguments are validated with Zod before any handler runs. Failures are returned to the model as data, not as stack traces.
- Input guardrails block oversized requests and requests to run code. Approval policy remains the main protection for scene changes.
- Rate limits, a JSON body size limit, restricted CORS origins, and localhost binding by default.

## HTTP API

All routes are under `/api/v1` and need `Authorization: Bearer <token>` except the health probes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health/live`, `/health/ready` | probes (no auth) |
| GET / POST / DELETE | `/api/v1/providers` and provider subroutes | encrypted provider configuration, selection, models, testing |
| GET | `/api/v1/agents`, `/api/v1/agents/:agentId` | registered agents |
| POST | `/api/v1/agent-runs` | start a run (202) |
| GET | `/api/v1/agent-runs/:runId` | run status and output |
| GET | `/api/v1/agent-runs/:runId/events` | SSE event stream |
| POST | `/api/v1/agent-runs/:runId/cancel` | cancel a run |
| GET | `/api/v1/agent-runs/:runId/approvals` | approval requests |
| POST | `/api/v1/agent-runs/:runId/approvals/:approvalId` | approve or reject |
| GET / POST | `/api/v1/projects` | list (search, scope, category, sort) and create projects |
| GET / PATCH / DELETE | `/api/v1/projects/:projectId` | read, rename, star, archive, delete |
| POST | `/api/v1/projects/:projectId/duplicate` | copy a project with its scene and imported models |
| POST | `/api/v1/projects/:projectId/scene/history/preview` | preview undo or redo without changing saved history |
| POST | `/api/v1/projects/:projectId/scene/history/commit` | commit a prepared history change with version and operation id |
| GET | `/api/v1/projects/:projectId/scene` | the scene's history: applied command batches and imported models, in order |
| POST | `/api/v1/projects/:projectId/assets` | import a model: the file is the body (`application/octet-stream`, up to 64 MB); `name`, `format` and `objectId` are query parameters |
| GET | `/api/v1/projects/:projectId/assets/:assetId` | download an imported model |
| GET | `/api/v1/projects/:projectId/conversation` | the latest chat of a project |
| DELETE | `/api/v1/projects/:projectId/conversation` | clear saved chat sessions and messages while retaining scene and undo history; rejected while an assistant run is active |
| POST | `/api/v1/sessions` | create a session |
| GET | `/api/v1/sessions/:sessionId` | read a session |
| DELETE | `/api/v1/sessions/:sessionId` | delete a session and its history |
| GET | `/api/v1/skills`, `/api/v1/skills/:skillId` | skills |

Errors use one shape: `{ "error": { "code", "message", "requestId", "details?" } }`. The `x-request-id` header is echoed back.

## Known limitations

- **Live inference is not verified with real provider credentials.** Tests mock inference for every vendor and exercise the real HTTP/SSE/WebSocket/editor pipeline. The Test connection action verifies key access and model listing; it does not bill a generation request.
- **ChatGPT subscription sign-in is unverified against the live service.** Tests mock the token endpoint and the model. The endpoints, client ID, redirect and request shape follow OpenAI's open-source Codex client, but the subscription backend is undocumented and can change. The model list is static; any model ID can be typed in. Port 1455 must be free during sign-in.
- **Automatic authentication and credential persistence currently require Windows.** DPAPI fails closed on other platforms. The backend is a separate process and must be started before use; the desktop retries its connection automatically.
- **Surface operations have bounded scope.** Bevel supports 1–8 segments, chamfer or round profiles, an angle limit, and manifold concave/open geometry. Subdivision uses Catmull–Clark, Linear or Loop at 1–3 levels. Live stacks preserve the base and interpolate texture, material and deformation data. Non-manifold geometry, overlapping widths and excessive refinement are rejected. New bevel faces use interpolated UVs rather than an automatic unwrap. A manual modifier panel supports these stacks with saved undo/redo. Animation editing and arbitrary mesh creation are not implemented.
- **Persistence is a single SQLite file.** It suits one local desktop process. Several backend processes would need a different store.
- **Local desktop authentication is not a remote login system.** The desktop discovers a DPAPI-protected bearer token through native IPC. Anyone able to run code as the same Windows account can access that account's credentials; DPAPI does not protect against a compromised user session.
- **Run recovery is conservative.** Runs active at shutdown are marked failed. Runs waiting for approval survive a restart, and their approvals can still be decided.
- **Plans survive an approval only.** Plans, proposals and verification state are saved when a run pauses for an approval and restored when it resumes. A run that ends for another reason keeps them only in memory, which is enough because the run has ended.
- **Input guardrails are heuristic.** They block obvious requests to run code. Approval and command validation remain the real protection against unwanted scene changes.
- **MCP servers are not connected.** The registry reads the configuration and enforces the tool allowlist. Connecting MCP servers and exposing their tools to agents is not wired up yet.
- **Blender is an interface only.** The disabled worker reports itself unavailable. No Blender process is started or managed.
- **Projects use claim-on-first-use ownership.** Real project membership and sharing do not exist yet.
- **Provider schema compatibility is unverified.** Tools use Zod schemas with the SDK's default strict mode. Optional fields may need adjusting to the provider's strict JSON schema rules before a real run.
- **Rate limiting is per process.** `RateLimitGuard` uses a fixed window per client address in memory. It is not a shared limiter.
- **Body-limit errors have no request id.** An oversized body is rejected by the body parser before the request-id middleware runs, so the 413 response uses `requestId: "unknown"`.
- **Startup prints one harmless warning.** Nest's adapter reports a legacy `path-to-regexp` route for `/api/*` while it sets up the prefix and CORS handling.
- **Installing needs one pnpm decision.** pnpm 12 stops on three optional native build scripts (`@parcel/watcher`, `@scarf/scarf`, `unrs-resolver`) unless you approve them with `pnpm approve-builds`. The backend runs without them.
- **Tests run as ESM.** NestJS 12 ships ESM only, so Jest runs with `--experimental-vm-modules`. The type-aware lint skips `*.spec.ts`, because Jest globals are not typed for it there; the specs are still type-checked.

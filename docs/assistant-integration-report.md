# Assistant integration and credential security

Verified on Windows on November 1, 2026.

## Delivered behavior

- The desktop automatically discovers and authenticates with the local backend through Tauri IPC. There is no access-token field. Failed connections retry automatically; General also offers Reconnect.
- Settings > Providers contains OpenAI, Anthropic, Google, OpenAI-compatible, and Anthropic-compatible options. Each provider supports entering/replacing a key, loading models with the plus button, entering/selecting a model, testing access, saving, selecting it as active, and removing its configuration.
- Unsaved keys can be used to load models and test access. Saving encrypts them on the backend; reads return only provider ID, model, endpoint, configured status, and active status.
- Prompt submission creates a real backend agent run. The assistant displays streamed text/tool progress, supports cancellation and approval/rejection, and continues the session on subsequent prompts. Changing provider, model, or compatible endpoint starts a fresh conversation session.
- The desktop authenticates its editor WebSocket and answers context requests. Validated proposals create actual Three.js primitives and support transforms and deletion. Batches are staged atomically, checked against scene revisions, and deduplicated by proposal ID. No arbitrary code or shell execution is accepted.
- `packages/editor-protocol` owns the shared Zod editor schemas used by both apps. Backend services own credentials, provider transport, model routing, runs, and approvals; React components remain presentation/client code.

## Running it

From the repository root:

```powershell
pnpm dev:backend
# In another terminal:
pnpm tauri dev
```

The backend must be running; this change connects to it automatically rather than bundling or launching a backend sidecar. It listens on `127.0.0.1:3001`. A `.env` file is optional. Configure real provider credentials through the desktop settings after startup.

## Where credentials are stored

Default location: `%LOCALAPPDATA%\Movynta` (on this machine, `C:\Users\Asif Computer\AppData\Local\Movynta`).

| File or location | Content and protection |
| --- | --- |
| `movynta.sqlite`, `model_providers.encrypted_key` | Provider keys encrypted with Windows DPAPI `CurrentUser`; additional entropy binds each ciphertext to its API user and provider. Provider/model selection is metadata. `DATABASE_URL` can override this file location. |
| `auth.dpapi` | Random backend signing secret, encrypted with DPAPI. Created when `AUTH_SECRET` is not supplied. Never sent to the desktop. |
| `connection.dpapi` | DPAPI-encrypted, expiring local desktop bearer credential. The backend refreshes this record hourly; native IPC decrypts it for in-memory use. No manual token entry is required. |
| Frontend state | Provider metadata only in Redux. A newly typed key exists transiently in the input component/request and is discarded when the form closes; it is not written to browser storage or Redux. |

The backend decrypts provider credentials only when needed for a vendor request. Official vendor calls use fixed HTTPS origins. Compatible endpoints require HTTPS, with HTTP allowed only for localhost/loopback; embedded URL credentials, query strings, and fragments are rejected. Compatible inference and model-list requests reject redirects. Changing a saved compatible endpoint requires a new key, and running/resumed requests cannot silently switch to a changed endpoint. Credentials and upstream error bodies are omitted from API responses, run events, and application logs. Configured-provider runs disable SDK tracing. Validation errors omit target objects and submitted values. Tauri CSP restricts network destinations to the app and local backend.

DPAPI protects at-rest data using the current Windows account. It does not protect against malware/debuggers running as that same account, an administrator controlling the account, or credentials in process memory while in use. Keys cannot be recovered under a different Windows account just by copying the database. Storage fails closed outside Windows; other operating systems need an equivalent credential-vault implementation.

## Verification before compatible-provider extension

| Check | Result |
| --- | --- |
| `pnpm check` | Passed strict TypeScript and oxlint for both apps. |
| `pnpm build` | Passed shared protocol, NestJS, and Vite production builds. |
| `cargo check --offline` | Passed native Tauri compile check. |
| Backend Jest suite | 96 tests passed across 10 suites. Includes real DPAPI roundtrip/tamper/owner-scope tests, redacted responses, provider isolation, provider selection/model routing for all three vendors, and the existing run/approval/cancellation/editor security tests. |
| `pnpm test:desktop` | 6 tests passed across 3 files. The end-to-end fixture runs real Nest HTTP/SSE/WebSocket services, real frontend API/editor connection code, real Three.js objects, and DPAPI with fake credentials; vendor inference is scripted with `@openai/agents/testing`. |
| Native UI inspection | Confirmed automatic connection in General and the fixed OpenAI/Anthropic/Google provider list in the running desktop app. |
| Scene benchmark | At 2,000 objects over 100 samples: snapshot averaged 0.45 ms; staged atomic transform averaged 8.14 ms on this machine. Runtime varies with hardware and load. |

The sandbox initially denied local HTTP/WebSocket connections; integration tests were rerun with loopback access and passed. No test called a real model provider or used real provider credentials.

## Remaining verification and limits

- Live OpenAI, Anthropic, and Google generation is unverified because no real API keys were supplied. Tests verify the routing and complete local protocol using scripted inference. Account-specific model availability, billing, rate limits, and live tool-schema behavior require a real account check. The same limitation applies to third-party compatible services.
- Test connection authenticates against the vendor model catalog and reports whether the selected model is listed. It does not issue a billed inference request or guarantee that every listed model supports this agent's tools.
- The Vite build reports a large JavaScript chunk (about 1.12 MB uncompressed, including Three.js). Code splitting remains a performance improvement opportunity.
- The full packaged installer/sidecar lifecycle was not tested. The native compile and running development desktop were checked.
- Existing Jest/Node experimental-module and hybrid-module warnings remain; they did not prevent the tests from passing.

## Implementation references

- [OpenAI Agents SDK models and providers](https://developers.openai.com/api/docs/guides/agents/models)
- [AI SDK Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google)
- [Anthropic model listing](https://platform.claude.com/docs/en/api/models/list)
- [Google model listing](https://ai.google.dev/api/models)

## Compatible-provider extension

OpenAI-compatible and Anthropic-compatible cards use the reusable provider editor, including a Base URL field. The URL is saved as metadata alongside DPAPI-encrypted credentials. OpenAI-compatible inference explicitly uses Chat Completions; Anthropic-compatible inference uses the Messages adapter. Custom API path prefixes are preserved when loading models. Endpoints should include the API version prefix (usually `/v1`), without `/models`, `/messages`, or `/chat/completions` appended.

These are two additional provider slots, one per compatible API protocol. Providers can still be switched using the active-provider control. Remote endpoints must use HTTPS; local HTTP endpoints such as `http://127.0.0.1:1234/v1` are accepted. A key is required when saving a new configuration. Some compatible services do not implement model listing: enter their model ID manually in that case. The existing Test connection action checks model-list access.

Verification for this extension: `pnpm check` and `pnpm build` passed; backend tests passed 107/107, and desktop tests passed 6/6. The end-to-end test configures and selects all five provider types, then executes a scripted agent through real HTTP/SSE/WebSocket and Three.js scene code. New tests cover endpoint canonicalization, authentication headers and proxy prefixes, redirect rejection, encrypted storage, key re-entry on endpoint changes, endpoint pinning for runs, and Chat Completions wrapper selection. Compatible services were not called with live credentials.

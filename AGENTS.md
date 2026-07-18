# AGENTS.md

Guidance for agents working in this Cloudflare Vignette starter. Read this before making changes:
it covers the architecture you must preserve, the library APIs you should reach for, recipes for
the most common tasks, and hard-won lessons from building a full game-show production on top of
this template.

## Contents

- [What this is](#what-this-is) — orientation and data flow
- [Commands](#commands) — how to build, run, and verify
- [Vocabulary](#vocabulary) — terms used throughout this file and the library
- [Project map](#project-map) — where each concern lives
- [Core invariants](#core-invariants) — rules that must never be broken
- [Library cheat sheet](#library-cheat-sheet) — what to import and from where
- [Recipe: change the composition](#recipe-change-the-composition)
- [Recipe: add live overlay state](#recipe-add-live-overlay-state-useremotestore)
- [Recipe: add a control route](#recipe-add-a-control-route)
- [The control client (studio pattern)](#the-control-client-studio-pattern)
- [CLI preview and OBS](#cli-preview-and-obs)
- [Animating overlays (Motion for React)](#animating-overlays-motion-for-react)
- [Optional stinger transitions](#optional-stinger-transitions)
- [Style and testing](#style-and-testing)
- [One-time setup: renaming a fresh copy](#one-time-setup-renaming-a-fresh-copy)

## What this is

A pnpm workspace for a React-authored Vignette composition hosted on a Cloudflare Worker.
Vignette (the `@strangecyan/vignette*` packages) lets React describe
broadcast graphics — sources, scenes, layers, and Yoga-laid-out boxes — as declarative data that
independent runtimes then realize: a DOM compositor in the browser and an OBS runtime over
obs-websocket.

In this starter:

- A **Durable Object** owns application state, renders the React composition exactly once, and
  publishes compiled runtime updates over SSE.
- The **Vignette CLI** consumes those updates for PNG previews and OBS convergence.
- The **browser client** renders the same composition with the DOM compositor and provides
  operator controls.
- **Frames** (`*.frame.tsx`) are server-rendered overlay documents served at the edge; they
  receive live data over their own SSE feed.

```text
operator controls --HTTP--> application store (Durable Object) --+--> composition
                            |                                    |        |
                            +--SSE /api/store/:ref--> frames ----+        +--SSE /api/runtime--> browser / OBS runtime
```

### The two SSE feeds are deliberately separate. Keep them separate.

- `/api/runtime` carries compiled Vignette **setup and composition updates** to the DOM and OBS
  runtimes. This is structural: which sources, scenes, and layers exist and where they sit.
- `/api/store/:ref` carries **serializable application state** to hydrated React frames. This is
  content: titles, scores, cues.

This split lets a frame react to show data without the composition rebuilding or the frame
document remounting. A state update must change an overlay without reconstructing the composition
or reloading the frame. The smoke test verifies this by placing a marker on the frame document and
checking it survives a mutation — if your change breaks that test, you have almost certainly
coupled the two feeds.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Build and run the composition locally at `http://127.0.0.1:5173`. |
| `pnpm exec vignette preview --snapshot http://127.0.0.1:5173/api/runtime --name vignette-starter` | Capture the first compiled scene as a PNG under `vignette-preview/`. |
| `pnpm exec vignette obs --project vignette-starter --obs-url ws://127.0.0.1:4455 --password <password> --url http://127.0.0.1:5173/api/runtime` | Run the standard OBS runtime until interrupted; omit `--password` when authentication is disabled. |
| `pnpm obs` | Run the same OBS CLI command with the starter defaults; append `-- --password <password>` when authentication is enabled. |
| `pnpm typecheck` | Typecheck every workspace package. |
| `pnpm build` | Build the Worker and browser assets. |
| `pnpm test:smoke` | Playwright smoke test against the real built worker: frame serving, state, SSE replay, mutation without reload. |
| `pnpm deploy` | Build and deploy the Worker. |

**Before declaring work done, run `pnpm typecheck` and `pnpm test:smoke`.** There are no separate
lint, format, or unit-test scripts in this workspace; the smoke test is the verification bar.
`pnpm test:smoke` builds first and runs against real routes, so it also catches build breakage.

Requirements: Node 22+, pnpm 11 (`corepack enable` once if pnpm is missing). Run `pnpm exec
playwright install chromium` once before using `vignette preview`.

## Vocabulary

These terms come from the Vignette library and are used precisely throughout this file:

- A **source** is one reusable resource definition — image, media, browser, color, or
  target-native. Declared once under `<Sources>`, placed many times.
- A **layer** is one placement of a source in a scene.
- A **box** is a virtual Yoga layout container. It participates in layout but never becomes a DOM
  or OBS object.
- A **scene** is an independently materialized arrangement of layers.
- A **frame** is a typed, server-rendered React overlay document (`*.frame.tsx`), placed in the
  composition via `View` and hydrated in the browser.
- A **compiled snapshot** is the immutable, target-neutral output of the composer, with a
  monotonic revision. Runtimes consume snapshots; they never see React.
- The **runtime message stream** is a closed union of `setup` (asset manifest), `update` (complete
  desired snapshot), and `event` (one-shot command).

Two identity rules follow from this model:

- Remote resources are identified by **stable explicit IDs** (`sceneId`, `sourceId`, `layerId`),
  never by React keys. Keys are reconciliation hints only.
- **Yoga owns layout.** The common style language is narrower than CSS by design; DOM CSS does not
  independently lay out the scene.

## Project map

| Concern | Starting point |
| --- | --- |
| Composition (sources, scenes, layers) | `apps/composition/src/composition.tsx` |
| Composer root construction (canvas, assets, Yoga) | `apps/composition/src/composition-runtime.ts` |
| Application state (@xstate/store + zod) | `apps/composition/src/state/composition-store.ts` |
| Durable Object persistence | `apps/composition/src/state/durable.ts` |
| Remote store reference (typed frame/server bridge) | `apps/composition/src/state/store-ref.ts` |
| Worker, API routes, Durable Object | `apps/composition/src/worker.tsx` |
| Overlay frame | `apps/composition/src/frames/title.frame.tsx` |
| Control client + programme preview | `apps/composition/src/client/App.tsx` |
| PNG preview and standard OBS runtime | `pnpm exec vignette preview ...` / `pnpm exec vignette obs ...` |
| Shared project identity | `packages/composition-config/src/index.ts` |
| Smoke test | `apps/composition/tests/smoke.spec.ts` |
| Vite plugins (Vignette, React, Tailwind, Cloudflare, Worker Yoga) | `apps/composition/vite.config.ts` |
| Worker name, DO binding, routes | `apps/composition/wrangler.jsonc` |

Keep `COMPOSITION_PROJECT_NAME` in `composition-config` consistent with the `--project` value passed
to `vignette obs`. That value identifies which OBS resources the project manages; do not introduce
another project ID in scripts or documentation.

## Core invariants

1. **Only serializable application state is persisted.** React trees, Vignette runtime objects,
   and stores are rebuilt when a Durable Object instance starts. Persist only the store context
   (`state/durable.ts`), and version the persisted shape when it evolves.
2. **The composition renders exactly once per Durable Object instance.** Dynamic configuration
   flows into React through `SceneProvider` and application state; never call `root.render` a
   second time to reflect a state change.
3. **Frames are stateless edge concerns.** `*.frame.tsx` files are discovered by the Vite plugin
   and served by the Worker without waking the Durable Object. Frames get live data by subscribing
   to `/api/store/:ref`, never by importing a server-side store. Frame modules are imported for
   both server rendering and browser hydration, so they must remain browser-safe.
4. **The platform owns the transport; the library owns the messages.** `root.messages(signal)`
   yields runtime messages and `toSseEvent` formats them. Swapping SSE for a WebSocket or queue is
   a change in `worker.tsx`, not in the library.
5. **Validate every mutation at the server boundary.** All control routes use zod schemas via
   `sValidator`. Cap text lengths before copy can go on air.
6. **Explicit IDs identify remote resources; React keys never do.**
7. **OBS resources outside the managed namespace are never touched.** The OBS target only
   creates, modifies, and deletes names under `vignette::<projectId>::`. Manual edits to managed
   resources are drift and are overwritten on the next convergence pass.
8. **Async target errors are not React exceptions.** The composer publishes revisions without
   waiting for DOM/OBS settlement. The standard CLI reports runtime errors to stderr; use a custom
   runtime only when an application must consume structured target status.

## Library cheat sheet

All Vignette packages are versioned together (currently `0.4.1`). Import from these paths — do not
hand-roll bridges the library already provides:

| Import path | Key exports used here |
| --- | --- |
| `@strangecyan/vignette` | `Broadcast`, `Sources`, `Scene`, `Layer`, `Box`, `SceneLayer`, `ColorSource`, `ImageSource`, `MediaSource`, `BrowserSource`, `createComposerRoot` |
| `@strangecyan/vignette-core` | `projectId`, `sceneId`, `sourceId`, `layerId`, `asset`, `LayoutStyle`, `deepFreeze` |
| `@strangecyan/vignette-core/sse` | `toSseEvent` (format `root.messages()` output for an SSE writer) |
| `@strangecyan/vignette-core/runtime` | `consumeRuntimeMessages` (apply a message stream to a runtime) |
| `@strangecyan/vignette-core/layout-yoga` | `yogaLayoutEngine` (Yoga-backed layout engine passed to the composer root) |
| `@strangecyan/vignette-frame` | `frame`, `View`, `SceneProvider`, `createSceneStore` |
| `@strangecyan/vignette-frame/remote-store` | `defineRemoteStore`, `encodeRemoteStoreSnapshot` |
| `@strangecyan/vignette-frame/remote-store/server` | `remoteStoreSnapshots` |
| `@strangecyan/vignette-frame/remote-store/client` | `useRemoteStore` |
| `@strangecyan/vignette-frame/server` | `createFrameRequestHandler` |
| `@strangecyan/vignette-target-dom/react` | `useCompositor`, `sseRuntimeSource` (browser) |
| `@strangecyan/vignette-cli` | `vignette preview` and `vignette obs` commands (default Node tooling) |
| `@strangecyan/vignette-target-obs` | `OBSRuntime`, codecs, and transports (custom-runtime escape hatch) |
| `@strangecyan/vignette-vite` | `vignette()` Vite plugin (frame discovery, asset manifests) |
| `virtual:vignette/frames`, `virtual:vignette/assets` | Generated `frames` / `assets` manifests from the Vite plugin |

Historical note: `useRemoteStore` and friends are part of the library. Do not build a
`lib/remote-store` bridge; older examples that did so predate the integration.

If you register a **custom source extension**, it has three facets that must be registered
separately: a source module on the composer root, a DOM renderer on `DOMRuntime`/`useCompositor`,
and an OBS codec on `OBSRuntime`. The CLI registers built-in codecs and the official MoQ codec, not
project-specific extensions. A custom OBS source therefore requires the custom-runtime escape hatch
described below (see the preview-parity rule under the control client).

## Recipe: change the composition

Structural changes — new sources, scenes, layers, or layout — happen in
`apps/composition/src/composition.tsx`:

1. Declare reusable sources under `<Sources>` with explicit `sourceId`s.
2. Place them in a `<Scene id={...}>` with `<Layer id={...} sourceId={...}>`, using `<Box>` for
   Yoga layout containers. Boxes are layout-only; they create no remote objects.
3. For image/media sources, reference files with `asset(...)` and register the glob in the
   `vignette({ assets: ... })` Vite plugin options — never handwrite public URLs. Both runtimes
   then resolve the same content-versioned file.
4. For a typed overlay document, define a frame (see below) and place it with `<View>` beneath
   `SceneProvider`.

Remember: the composition describes *structure*. If you are tempted to re-render the composition
to change *content* (a title, a score), you want the remote-store path instead.

Constraints inherited from the library's compatibility contract:

- Media needs declared dimensions/aspect information; there is no async intrinsic sizing.
- DOM supports opacity; OBS diagnoses and omits non-unit opacity in V1.
- A reusable browser source cannot have incompatible realized native sizes in OBS; use distinct
  source IDs instead.

## Recipe: add live overlay state (`useRemoteStore`)

The complete data path for a remotely driven value:

```text
POST /api/title -> validate -> store.trigger.setTitle -> persist context
  -> SSE /api/store/composition -> useRemoteStore(...) -> re-render inside the existing frame
```

To add a new remotely driven value:

1. **Define serializable state and events** in the `@xstate/store` store with zod-validated
   events (`state/composition-store.ts`). Keep the shape serializable — it is what the Durable
   Object persists.

2. **Give the store a typed reference** — a stable ID, a URL, and a phantom type, so frames can
   infer the snapshot type without importing the live store (`state/store-ref.ts`):

   ```ts
   import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";

   export const compositionStoreRef = defineRemoteStore<CompositionStore>({
     id: "composition",
     url: "/api/store/composition",
   });
   ```

3. **Stream snapshots from the server** (`worker.tsx`). The endpoint must replay the current
   snapshot immediately, then send updates for the lifetime of the request:

   ```ts
   import { encodeRemoteStoreSnapshot } from "@strangecyan/vignette-frame/remote-store";
   import { remoteStoreSnapshots } from "@strangecyan/vignette-frame/remote-store/server";

   return streamSSE(c, async (stream) => {
     for await (const snapshot of remoteStoreSnapshots(store, c.req.raw.signal)) {
       await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
     }
   });
   ```

   `remoteStoreSnapshots` conflates updates while a consumer is busy. That is right for graphics —
   a slow client needs the newest score, not every intermediate one. Use a different protocol when
   every event matters (for example a queue of timed cues that the current state does not fully
   describe).

4. **Subscribe from the frame** with a selector:

   ```tsx
   import { useRemoteStore } from "@strangecyan/vignette-frame/remote-store/client";

   const title = useRemoteStore(compositionStoreRef, (state) => state.context.title);
   ```

   `EventSource` reconnects automatically and the server replay supplies the latest state after
   reconnection. The selector gives typed projection but not equality-aware memoization: every
   accepted snapshot notifies each subscriber. Add equality-aware selection if you send frequent
   updates to many independent frame components.

5. **Handle hydration.** The hook suspends during server rendering and until the first SSE message.
   Put the consumer directly below a normal `Suspense` boundary with a transparent (`null`)
   fallback; the frame hydrator handles the expected server-to-client Suspense recovery. Stale or
   loading UI must not cover programme video. See `frames/title.frame.tsx`.

**Checklist when touching this path:** test initial replay, live update without frame reload,
reconnect behavior, and unknown store IDs (return 404). Extend `tests/smoke.spec.ts` accordingly.
In production, authenticate both the mutation and the state-stream endpoints — read-only does not
mean non-sensitive — and configure proxy buffering and idle timeouts so SSE is delivered
immediately and stays open.

## Recipe: add a control route

Routes live in the chained Hono app in `worker.tsx`:

1. Add a zod event schema next to the store event it triggers (`state/composition-store.ts`).
2. Add the route to the existing chained app with `sValidator` — **preserve the chained style**;
   the exported `CompositionApi` type feeds `hono/client`, and breaking the chain breaks
   end-to-end inference in `client/App.tsx`.
3. Trigger the store event; persistence happens via the store subscription in `state/durable.ts`.
4. Keep commands narrow and semantic (`title`, `mode`, a complete cue) — never expose generic
   store writes.

## The control client (studio pattern)

`client/App.tsx` combines two products: a control surface that mutates application state and a
programme monitor that renders the compiled scene exactly as a runtime would. Create the runtime
source once at module scope, then pass that stable function to `useCompositor`; calling
`sseRuntimeSource("/api/runtime")` inline creates a new transport on every render, repeatedly
restarts the compositor, and eventually causes React's maximum-update-depth error. Rules that keep
it trustworthy:

- **The server store is the source of truth, never the preview.** Reopening the client or adding
  a second operator must reproduce the current show.
- **Keep the API typed end-to-end** through `hc<CompositionApi>` as described above.
- **Drafts stay off-air.** Forms edit local state and send one complete cue on submit; immediate
  controls (cuts, locks) may send small patches directly. Do not mutate programme output on every
  keystroke.
- **Design for operator confidence.** Every action needs pending, disabled, and error states, and
  a pending guard against double cues. Surface `compositor.phase` and `compositor.revision` near
  the preview so an operator can distinguish an intentional black frame from a stale compositor.
- **Distinguish acknowledgements.** A successful control response means the server persisted the
  command; a runtime revision means a composition update reached the preview; a source return
  means external media is actually flowing. Expose these separately rather than one green badge.
- **Preview with the same extensions as the destination runtime.** If you register a custom
  source extension for OBS, register its DOM counterpart in the preview's `useCompositor` call, or
  the preview will look healthy while the destination fails.

For larger productions: add auth and roles on every control command, an audit trail, conflict
handling for concurrent operators (sequence numbers or expected revisions), and separate
preview/programme buses with an explicit Take. This starter drives programme output directly,
which is fine for a compact show but provides no rehearsal bus.

## CLI preview and OBS

The CLI is the default runtime tooling for this starter. Do not create an application-owned OBS
process merely to connect the standard runtime SSE endpoint.

With `pnpm dev` running, preview the compiled composition before opening OBS:

```sh
pnpm exec vignette preview \
  --snapshot http://127.0.0.1:5173/api/runtime \
  --name vignette-starter
```

The command captures the first scene under `vignette-preview/`. Use `--scene <id>` for one named
scene or `--all-scenes` for the whole composition. It renders live media and extension sources as
labeled placeholders, so use it for layout and static-content inspection rather than return-feed
health.

For OBS, enable OBS WebSocket and run:

```sh
pnpm exec vignette obs \
  --project vignette-starter \
  --obs-url ws://127.0.0.1:4455 \
  --password '<password>' \
  --url http://127.0.0.1:5173/api/runtime
```

Omit `--password` when authentication is disabled. The command includes the standard built-in
source codecs and official MoQ codec, reconnects through the library runtime behavior, and runs
until `SIGINT` or `SIGTERM`. It deliberately does not expose health or readiness endpoints.

The library-enforced safety model still applies: only scenes and inputs named
`vignette::<projectId>::...`, plus the registry scene, are managed. Everything else in OBS remains
out of bounds. The `--project` value must match `COMPOSITION_PROJECT_NAME`.

Escape hatch to an application-owned `OBSRuntime` only when the project concretely needs at least
one capability the CLI does not provide:

- project-specific OBS codecs or overrides to built-in codec settings;
- a non-SSE transport, custom asset storage, or injected OBS transport;
- structured `getStatus()`/`whenSettled()` integration, a health/readiness endpoint, or process
  supervision contract;
- application-specific retry, logging, metrics, or lifecycle integration.

When taking the escape hatch, keep the process thin and free of application logic. It should
consume runtime messages, register only required extensions, expose errors/status, and dispose on
shutdown; it must never read the application store or bypass the managed-namespace safety model.

## Animating overlays (Motion for React)

When adding animated graphics, use the `motion` package via `motion/react` (not the older
`framer-motion` name) and follow these rules:

- Define one motion language — a single easing family (for example
  `const broadcastEase = [0.16, 1, 0.3, 1] as const`) and a small duration scale — and apply
  defaults once with `<MotionConfig transition={...}>` at the overlay root.
- Drive animation from semantic show state, not per-component timers. Give `AnimatePresence`
  children stable, meaningful keys; use `mode="wait"` so two full-screen treatments never overlap;
  set `initial={false}` so a preview joining an already-running show does not replay entrances.
- Choreograph groups with variants and `stagger()` instead of manual per-child delays. Keep
  complete builds under about a second — long decorative sequences become operational latency.
- Use tweens for predictable cue timing, springs for spatial continuity (`layoutId`), and short
  keyframes for reactions. Avoid perpetual animation; constant motion competes with the programme.
- Keep the frame transparent: animate children, never paint an opaque background on the root.
  Prefer `opacity` and `transform`; test `layout`/`layoutId`, production fonts, and large blurs at
  the real 1920x1080 canvas and target frame rate.
- Test rapid consecutive cues and interrupted exits, not only the happy path.

Motion is time-based and live; it suits lower thirds and mode transitions. For a transition that
must hit an exact full-cover frame and be reused in OBS, use a rendered asset instead (below).

## Optional stinger transitions

Stingers are deliberately not included in this starter. If a production needs one, create a
separate animation/rendering workspace (Remotion is one option), render a transparent media asset,
register that output through Vignette's asset manifest, and cue it with explicit application state.
Verify transparent first/last frames, a fully opaque cut window, repeat playback, and alpha support
in both DOM and OBS. Keep the rendering toolchain and generated masters out of the base starter.

## Style and testing

- TypeScript throughout, explicit `ReactElement` return types, `readonly` state shapes, and zod
  schemas colocated with the store events they validate.
- Tailwind for client UI; frames may use inline styles since they render in isolated documents.
- Smoke tests run against the real built worker, frame, and asset routes — not mocked components.
  When you add a feature on the state path, extend `apps/composition/tests/smoke.spec.ts` to cover
  replay, live mutation without reload, and error cases.
- Give test-relevant frame elements `data-testid` attributes (see `data-testid="live-title"`).

## One-time setup: renaming a fresh copy

A template copy (GitHub "Use this template" or `degit`) arrives verbatim; nothing substitutes
project names. Before feature work in a new copy, choose an application slug, workspace package
scope, and Vignette project name, then:

1. Replace `cloudflare-vignette-starter` in the root `package.json` and
   `apps/composition/wrangler.jsonc`. The Wrangler name must be unique within the target
   Cloudflare account so deploying one generated project cannot overwrite another.
2. Replace `cloudflare_vignette_starter` in composition scripts, `playwright.config.ts`, and
   `vite.config.ts` with the underscore-normalized Wrangler environment name emitted for the new
   application slug. Keep these values in sync with the generated
   `dist/<environment>/wrangler.json` path.
3. Replace the `@vignette-starter` package scope in every workspace `package.json` and TypeScript
   import. Internal dependency names and root `--filter` commands must match the renamed packages.
4. Change `COMPOSITION_PROJECT_NAME` in `packages/composition-config/src/index.ts`, then use the same
   value for `vignette obs --project`. Do not introduce separate copies. This name determines the
   project's managed OBS namespace.
5. Run `pnpm install` to refresh `pnpm-lock.yaml`, then run `pnpm typecheck` and
   `pnpm test:smoke` before making further changes.

Use `rg 'cloudflare[-_]vignette[-_]starter|@vignette-starter|vignette-starter'` after renaming to
catch stale starter identifiers. Matches in explanatory documentation may remain when intentional;
runtime configuration, package manifests, imports, scripts, and the lockfile must use the new
names.

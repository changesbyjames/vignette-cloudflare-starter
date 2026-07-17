# AGENTS.md

Guidance for agents working in this Vignette starter. It covers the architecture you must
preserve, the conventions the code follows, and hard-won lessons from building a full game-show
production on top of this template.

## What this is

A pnpm workspace for a React-authored Vignette composition hosted on a Cloudflare Worker. A
Durable Object owns application state and publishes runtime updates over SSE. A separate Node
process applies those updates to OBS. The browser client renders the same composition with the
DOM compositor.

```text
operator controls --HTTP--> application store (Durable Object) --+--> composition
                            |                                    |        |
                            +--SSE /api/store/:ref--> frames ----+        +--SSE /api/runtime--> browser / OBS runtime
```

There are two deliberately separate SSE feeds. Keep them separate:

- `/api/runtime` carries compiled Vignette setup and composition updates to DOM and OBS runtimes.
- `/api/store/:ref` carries serializable application state to hydrated React frames.

This split lets the composition describe sources, scenes, and layers while a frame independently
reacts to show data without rebuilding or remounting its document. A state update must change an
overlay without reconstructing the composition or reloading the frame; the smoke test verifies
this by placing a marker on the frame document and checking it survives a mutation.

## Commands

- `pnpm dev` — build and run the composition locally at `http://127.0.0.1:5173`.
- `pnpm obs` — run the Node OBS runtime (needs `OBS_URL`, `OBS_PASSWORD`; see `apps/obs-runtime/.env.example`).
- `pnpm typecheck` — typecheck every workspace package.
- `pnpm build` — build the Worker and browser assets.
- `pnpm test:smoke` — Playwright smoke test: frame serving, state, SSE replay, mutation without reload.
- `pnpm deploy` — build and deploy the Worker.

Run `pnpm typecheck` and `pnpm test:smoke` before declaring work done.

## Initialize a degit copy

`degit` copies the starter verbatim; it does not substitute project names. Before feature work in a
new copy, choose an application slug, workspace package scope, and Vignette project name, then:

1. Replace `cloudflare-vignette-starter` in the root `package.json` and
   `apps/composition/wrangler.jsonc`. The Wrangler name must be unique within the target Cloudflare
   account so deploying one generated project cannot overwrite another.
2. Replace `cloudflare_vignette_starter` in composition scripts, `playwright.config.ts`, and
   `vite.config.ts` with the underscore-normalized Wrangler environment name emitted for the new
   application slug. Keep these values in sync with the generated `dist/<environment>/wrangler.json`
   path.
3. Replace the `@vignette-starter` package scope in every workspace `package.json` and TypeScript
   import. Internal dependency names and root `--filter` commands must match the renamed packages.
4. Change `COMPOSITION_PROJECT_NAME` in `packages/composition-config/src/index.ts`. Both the Worker
   and OBS runtime intentionally import this shared value; do not introduce separate copies.
5. Run `pnpm install` to refresh `pnpm-lock.yaml`, then run `pnpm typecheck` and
   `pnpm test:smoke` before making further changes.

Use `rg 'cloudflare[-_]vignette[-_]starter|@vignette-starter|vignette-starter'` after renaming to
catch stale starter identifiers. Matches in explanatory documentation may remain when intentional;
runtime configuration, package manifests, imports, scripts, and the lockfile must use the new names.

## Project map

| Concern | Starting point |
| --- | --- |
| Composition (sources, scenes, layers) | `apps/composition/src/composition.tsx` |
| Application state (@xstate/store + zod) | `apps/composition/src/state/composition-store.ts` |
| Durable Object persistence | `apps/composition/src/state/durable.ts` |
| Remote store reference | `apps/composition/src/state/store-ref.ts` |
| Worker, API routes, Durable Object | `apps/composition/src/worker.tsx` |
| Overlay frame | `apps/composition/src/frames/title.frame.tsx` |
| Control client + programme preview | `apps/composition/src/client/App.tsx` |
| OBS runtime | `apps/obs-runtime/src/index.ts` |
| Shared project identity | `packages/composition-config/src/index.ts` |

Keep `COMPOSITION_PROJECT_NAME` in `composition-config` consistent across runtimes; the OBS
runtime uses it to identify the project it manages.

## Core invariants

1. **Only serializable application state is persisted.** React trees, Vignette runtime objects,
   and stores are rebuilt when a Durable Object instance starts. Persist only the store context
   (`state/durable.ts`), and version the persisted shape when it evolves.
2. **The composition renders exactly once per Durable Object instance.** Dynamic configuration
   flows into React through `SceneProvider` and application state; never call `root.render` a
   second time to reflect a state change.
3. **Frames are stateless edge concerns.** `*.frame.tsx` files are discovered by the Vite plugin
   and served at the worker without waking the Durable Object. Frames get live data by
   subscribing to `/api/store/:ref`, never by importing a server-side store.
4. **The platform owns the transport; the library owns the messages.** `root.messages(signal)`
   yields runtime messages and `toSseEvent` formats them. Swapping SSE for a WebSocket or queue is
   a change in `worker.tsx`, not in the library.
5. **Validate every mutation at the server boundary.** All control routes use zod schemas via
   `sValidator`. Cap text lengths before copy can go on air.

## Live overlay state with `useRemoteStore`

`useRemoteStore` is part of the Vignette library, imported from
`@cbj/vignette-frame/remote-store` and its `/client` and `/server` subpaths. Do not hand-roll a
`lib/remote-store` bridge; older examples that did so predate the integration.

The data path:

```text
POST /api/title -> validate -> store.trigger.setTitle -> persist context
  -> SSE /api/store/composition -> useRemoteStore(...) -> re-render inside the existing frame
```

To add a new remotely driven value:

1. **Define serializable state and events** in an `@xstate/store` store with zod-validated
   events (`state/composition-store.ts`).
2. **Give the store a typed reference** — a stable ID, a URL, and a phantom type, so frames can
   infer the snapshot type without importing the live store:

   ```ts
   import { defineRemoteStore } from "@cbj/vignette-frame/remote-store";

   export const compositionStoreRef = defineRemoteStore<CompositionStore>({
     id: "composition",
     url: "/api/store/composition",
   });
   ```

3. **Stream snapshots from the server.** The endpoint must replay the current snapshot
   immediately, then send updates for the lifetime of the request:

   ```ts
   import { encodeRemoteStoreSnapshot } from "@cbj/vignette-frame/remote-store";
   import { remoteStoreSnapshots } from "@cbj/vignette-frame/remote-store/server";

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
   import { useRemoteStore } from "@cbj/vignette-frame/remote-store/client";

   const title = useRemoteStore(compositionStoreRef, (state) => state.context.title);
   ```

   `EventSource` reconnects automatically and the server replay supplies the latest state after
   reconnection. The selector gives typed projection but not equality-aware memoization: every
   accepted snapshot notifies each subscriber. Add equality-aware selection if you send frequent
   updates to many independent frame components.

5. **Handle hydration.** The hook suspends until the first SSE message and cannot resolve during
   server rendering. Put consumers below a `Suspense` boundary with a transparent (`null`)
   fallback — stale or loading UI must not cover programme video. See `frames/title.frame.tsx`.

Checklist when touching this path: test initial replay, live update without frame reload,
reconnect behavior, and unknown store IDs (return 404). In production, authenticate both the
mutation and the state-stream endpoints — read-only does not mean non-sensitive — and configure
proxy buffering and idle timeouts so SSE is delivered immediately and stays open.

## The control client (studio pattern)

`client/App.tsx` combines two products: a control surface that mutates application state and a
programme monitor that renders the compiled scene exactly as a runtime would. Rules that keep it
trustworthy:

- **The server store is the source of truth, never the preview.** Reopening the client or adding
  a second operator must reproduce the current show.
- **Keep the API typed end-to-end.** Routes are one chained Hono app; the exported
  `CompositionApi` type feeds `hono/client` so request bodies and responses stay aligned with the
  zod schemas. Preserve the chained style when adding routes or the inference breaks.
- **Keep commands narrow and semantic.** Let operators submit `title`, `mode`, or a complete cue
  — never expose generic store writes.
- **Drafts stay off-air.** Forms edit local state and send one complete cue on submit; immediate
  controls (cuts, locks) may send small patches directly. Do not mutate programme output on every
  keystroke.
- **Design for operator confidence.** Every action needs pending, disabled, and error states, and
  a pending guard against double cues. Surface `compositor.phase` and `compositor.revision` near
  the preview so an operator can distinguish an intentional black frame from a stale compositor.
- **Distinguish acknowledgements.** A successful control response means the server persisted the
  command; a runtime revision means a composition update reached the preview; a source return
  means external media is actually flowing. Expose these separately rather than one green badge.
- **Preview with the same extensions as the destination runtime.** If you register a custom DOM
  renderer or source extension for OBS, register its DOM counterpart in the preview's
  `useCompositor` call, or the preview will look healthy while the destination fails.

For larger productions: add auth and roles on every control command, an audit trail, conflict
handling for concurrent operators (sequence numbers or expected revisions), and separate
preview/programme buses with an explicit Take. This starter drives programme output directly,
which is fine for a compact show but provides no rehearsal bus.

## Animating overlays (Motion for React)

When adding animated graphics, use the `motion` package via `motion/react` (not the older
`framer-motion` name) and follow these rules:

- Define one motion language — a single easing family (for example
  `const broadcastEase = [0.16, 1, 0.3, 1] as const`) and a small duration scale — and apply
  defaults once with `<MotionConfig  transition={...}>` at the overlay root.
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

## Stinger transitions (Remotion)

A stinger starts transparent, fully covers the canvas, and ends transparent; switch the programme
source while it is fully opaque. Lessons that matter when adding one:

- **Keep Remotion in its own workspace app** (for example `apps/stingers`). Deterministic rendered
  assets and live frame code have different timing models; do not mix them.
- **Match the Vignette canvas exactly** (1920x1080 at 60fps) and make timing phases explicit with
  `interpolate` and clamped extrapolation. Keep the first and last frames fully transparent so
  toggling the media layer can never flash an opaque pixel, and give the director a generous
  fully-covered cut window.
- **Preserve alpha through the whole pipeline**: render with `--image-format=png --codec=vp9
  --pixel-format=yuva420p` for browser WebM, and keep a ProRes 4444 (`yuva444p10le`) master so you
  can transcode without rerendering. VP9 alpha support varies; test the exact DOM and OBS targets.
- **Register outputs as Vignette assets** (`vignette({ assets: "src/assets/**/*" })` plus
  `asset(...)` in a `MediaSource`) rather than handwritten public URLs, so both runtimes resolve
  the same content-versioned file.
- **Restart playback on every cue.** A retained `<video>` does not seek to zero when its layer
  becomes visible again. Use a DOM renderer extension that detects the hidden-to-visible edge,
  sets `currentTime = 0`, and plays; for OBS, wrap the media codec with
  `close_when_inactive: false` and `restart_on_activate: true`.
- **Model a cue as `{ kind, sequence }`, not a boolean.** Visibility comes from `kind`; the
  monotonically increasing `sequence` prevents an older cleanup timer from hiding a newer stinger.
  Have the server reset `kind` after the stinger duration (mirror the timer with a Durable Object
  alarm so cleanup survives eviction), and keep that duration synchronized with
  `durationInFrames / fps` plus a small margin.
- Before air: check first/last frame transparency over a checkerboard, retrigger behavior, rapid
  double cues, cold-load preload, and alpha/pacing on every target platform.

## Style and testing notes

- TypeScript throughout, explicit `ReactElement` return types, `readonly` state shapes, and
  zod schemas colocated with the store events they validate.
- Tailwind for client UI; frames may use inline styles since they render in isolated documents.
- Smoke tests run against the real built worker, frame, and asset routes — not mocked components.
  When you add a feature on the state path, extend `apps/composition/tests/smoke.spec.ts` to cover
  replay, live mutation without reload, and error cases.

# AGENTS.md

This document gives instructions for agents that work on this Cloudflare Vignette starter.
Read this document before you change the project.
Obey the architecture rules, API rules, procedures, and test requirements in this document.

Project-specific names, code identifiers, and broadcast terms are approved technical terms in this document.

## Contents

- [System description](#system-description)
- [Commands](#commands)
- [Terms](#terms)
- [Project files](#project-files)
- [Architecture rules](#architecture-rules)
- [Library imports](#library-imports)
- [Change the composition](#change-the-composition)
- [Add live overlay state](#add-live-overlay-state)
- [Add a control route](#add-a-control-route)
- [Control client](#control-client)
- [CLI preview and OBS](#cli-preview-and-obs)
- [Animate overlays](#animate-overlays)
- [Optional stinger transitions](#optional-stinger-transitions)
- [Code style and tests](#code-style-and-tests)
- [Rename a new copy](#rename-a-new-copy)

## System description

This project is a pnpm workspace.
It contains a Vignette composition that uses React.
A Cloudflare Worker hosts the composition.

Vignette includes the `@strangecyan/vignette*` packages.
Vignette lets React describe broadcast graphics as declarative data.
This data defines sources, scenes, layers, and boxes that use Yoga layout.
Separate runtimes use this data to make the graphics.
The browser uses a DOM compositor.
OBS uses a runtime through obs-websocket.

This starter has these parts:

- A **Durable Object** owns the application state.
- The Durable Object renders the React composition one time.
- The Durable Object sends compiled runtime updates through SSE.
- The **Vignette CLI** uses the updates for PNG previews and OBS convergence.
- **OBS convergence** makes managed OBS resources agree with the compiled composition.
- The **browser client** uses the DOM compositor to render the same composition.
- The browser client also gives controls to the operator.
- **Frames** are server-rendered overlay documents in `*.frame.tsx` files.
- The Worker serves frames at the edge.
- Frames receive live data through a separate SSE feed.

```text
operator controls --HTTP--> application store (Durable Object) --+--> composition
                            |                                    |        |
                            +--SSE /api/store/:ref--> frames ----+        +--SSE /api/runtime--> browser / OBS runtime
```

### Keep the two SSE feeds separate

- `/api/runtime` sends compiled Vignette setup data and composition updates to the DOM and OBS runtimes.
- This feed defines the sources, scenes, layers, and their positions.
- `/api/store/:ref` sends serializable application state to hydrated React frames.
- This feed contains data such as titles, scores, and cues.

This separation lets a frame respond to show data without a new composition build.
It also prevents the frame document from mounting again.
A state update must change an overlay without rebuilding the composition or reloading the frame.

The smoke test puts a marker on the frame document.
The test makes sure that the marker stays after a state change.
If the marker does not stay, the change probably connected the two feeds incorrectly.

## Commands

| Command | Function |
| --- | --- |
| `pnpm dev` | Build and run the local composition at `http://127.0.0.1:5173`. |
| `pnpm exec vignette preview --snapshot http://127.0.0.1:5173/api/runtime --name vignette-starter` | Save the first compiled scene as a PNG in `vignette-preview/`. |
| `pnpm exec vignette obs --project vignette-starter --obs-url ws://127.0.0.1:4455 --password <password> --url http://127.0.0.1:5173/api/runtime` | Run the standard OBS runtime until an interrupt occurs. |
| `pnpm obs` | Run the OBS CLI command with the starter default values. |
| `pnpm typecheck` | Type-check all workspace packages. |
| `pnpm build` | Build the Worker and the browser assets. |
| `pnpm test:smoke` | Run the Playwright smoke test against the built Worker. |
| `pnpm deploy` | Build and deploy the Worker. |

If OBS authentication is off, remove `--password` from the full OBS command.
If OBS authentication is on, add `-- --password <password>` to `pnpm obs`.

Before you complete work, run `pnpm typecheck` and `pnpm test:smoke`.
This workspace does not have separate lint, format, or unit-test scripts.
The smoke test is the required verification test.
The smoke test builds the project and tests the real routes.
Thus, it also finds build failures.

Use Node 22 or later.
Use pnpm 11.
If pnpm is not available, run `corepack enable` one time.
Before the first Vignette preview, run `pnpm exec playwright install chromium` one time.

## Terms

Use these Vignette terms with the specified meanings:

- A **source** is one reusable resource definition.
- A source can define an image, media, browser, color, or target-native resource.
- Declare a source one time under `<Sources>`.
- You can place the source many times.
- A **layer** is one placement of a source in a scene.
- A **box** is a virtual container that uses Yoga layout.
- A box participates in layout, but it does not become a DOM or OBS object.
- A **scene** is an arrangement of layers that a runtime can make independently.
- A **frame** is a typed, server-rendered React overlay document in a `*.frame.tsx` file.
- Place a frame in the composition with `View`.
- The browser hydrates the frame.
- A **compiled snapshot** is the immutable, target-neutral output of the composer.
- Each compiled snapshot has a revision that always increases.
- Runtimes use snapshots and do not receive React.
- The **runtime message stream** is a closed union of `setup`, `update`, and `event` messages.
- A `setup` message contains the asset manifest.
- An `update` message contains the complete required snapshot.
- An `event` message contains a command that occurs one time.

Use these identity and layout rules:

- Identify remote resources with stable, explicit `sceneId`, `sourceId`, and `layerId` values.
- Do not identify remote resources with React keys.
- React keys only help React reconcile elements.
- Yoga controls the layout.
- The common style language intentionally has fewer features than CSS.
- DOM CSS must not independently control scene layout.

## Project files

| Function | Start file or command |
| --- | --- |
| Composition sources, scenes, and layers | `apps/composition/src/composition.tsx` |
| Composer root, canvas, assets, and Yoga | `apps/composition/src/composition-runtime.ts` |
| Application state with @xstate/store and zod | `apps/composition/src/state/composition-store.ts` |
| Durable Object persistence | `apps/composition/src/state/durable.ts` |
| Typed remote store reference | `apps/composition/src/state/store-ref.ts` |
| Worker, API routes, and Durable Object | `apps/composition/src/worker.tsx` |
| Overlay frame | `apps/composition/src/frames/title.frame.tsx` |
| Control client and program preview | `apps/composition/src/client/App.tsx` |
| PNG preview and standard OBS runtime | `pnpm exec vignette preview ...` and `pnpm exec vignette obs ...` |
| Smoke test | `apps/composition/tests/smoke.spec.ts` |
| Vite plugins | `apps/composition/vite.config.ts` |
| Worker name, Durable Object binding, and routes | `apps/composition/wrangler.jsonc` |

Keep `COMPOSITION_PROJECT_ID` in `composition.tsx` equal to the `vignette obs --project` value in the root script.
This value identifies the OBS resources that the project manages.
Do not add a different project ID to scripts or documentation.

## Architecture rules

1. **Persist only serializable application state.**
   Rebuild React trees, Vignette runtime objects, and stores when a Durable Object instance starts.
   Persist only the store context in `state/durable.ts`.
   Add a version when you change the persisted data shape.

2. **Render the composition one time for each Durable Object instance.**
   Send dynamic configuration to React through `SceneProvider` and application state.
   Do not call `root.render` again for a state change.

3. **Keep frames stateless at the edge.**
   The Vite plugin finds `*.frame.tsx` files.
   The Worker serves these files without starting the Durable Object.
   Frames must subscribe to `/api/store/:ref` for live data.
   Frames must not import a server-side store.
   Both server rendering and browser hydration import frame modules.
   Thus, frame modules must be safe for the browser.

4. **Let the platform control the transport and the library control the messages.**
   `root.messages(signal)` supplies runtime messages.
   `toSseEvent` changes these messages to the SSE format.
   To replace SSE with a WebSocket or queue, change `worker.tsx`.
   Do not make this transport change in the library.

5. **Validate each mutation at the server boundary.**
   Use zod schemas through `sValidator` for all control routes.
   Limit text length before the text can go on air.

6. **Use explicit IDs for remote resources.**
   Do not use React keys as remote resource IDs.

7. **Do not change OBS resources outside the managed namespace.**
   The OBS target can create, change, and delete names only under `vignette::<projectId>::`.
   Manual changes to managed resources cause drift.
   The next convergence operation replaces these manual changes.

8. **Do not handle asynchronous target errors as React exceptions.**
   The composer publishes revisions without waiting for DOM or OBS to settle.
   The standard CLI writes runtime errors to standard error.
   Use a custom runtime only if the application must use structured target status.

## Library imports

All Vignette packages use the same version.
The current version is `0.4.1`.
Import the listed items from these paths.
Do not make a replacement for a bridge that the library supplies.

| Import path | Exports used in this project |
| --- | --- |
| `@strangecyan/vignette` | `Broadcast`, `Sources`, `Scene`, `Layer`, `Box`, `SceneLayer`, `ColorSource`, `ImageSource`, `MediaSource`, `BrowserSource`, `createComposerRoot` |
| `@strangecyan/vignette-core` | `projectId`, `sceneId`, `sourceId`, `layerId`, `asset`, `LayoutStyle`, `deepFreeze` |
| `@strangecyan/vignette-core/sse` | `toSseEvent` formats `root.messages()` output for an SSE writer. |
| `@strangecyan/vignette-core/runtime` | `consumeRuntimeMessages` applies a message stream to a runtime. |
| `@strangecyan/vignette-core/layout-yoga` | `yogaLayoutEngine` supplies the Yoga layout engine to the composer root. |
| `@strangecyan/vignette-frame` | `frame`, `View`, `SceneProvider`, `createSceneStore` |
| `@strangecyan/vignette-frame/remote-store` | `defineRemoteStore`, `encodeRemoteStoreSnapshot` |
| `@strangecyan/vignette-frame/remote-store/server` | `remoteStoreSnapshots` |
| `@strangecyan/vignette-frame/remote-store/client` | `useRemoteStore` |
| `@strangecyan/vignette-frame/server` | `createFrameRequestHandler` |
| `@strangecyan/vignette-target-dom/react` | `useCompositor`, `sseRuntimeSource` for the browser |
| `@strangecyan/vignette-cli` | `vignette preview` and `vignette obs` commands for Node |
| `@strangecyan/vignette-target-obs` | `OBSRuntime`, codecs, and transports for a custom runtime |
| `@strangecyan/vignette-vite` | `vignette()` Vite plugin for frame discovery and asset manifests |
| `virtual:vignette/frames`, `virtual:vignette/assets` | Generated `frames` and `assets` manifests from the Vite plugin |

`useRemoteStore` and its related functions are part of the library.
Do not make a `lib/remote-store` bridge.
Old examples can contain this bridge because they were made before the library integration.

A custom source extension has three separate parts:

- Register a source module on the composer root.
- Register a DOM renderer on `DOMRuntime` or `useCompositor`.
- Register an OBS codec on `OBSRuntime`.

The CLI registers the built-in codecs and the official MoQ codec.
The CLI does not register project-specific extensions.
Therefore, a custom OBS source requires a custom runtime.
Also obey the preview parity rule in the [Control client](#control-client) section.

## Change the composition

Make structural changes in `apps/composition/src/composition.tsx`.
Structural changes include new sources, scenes, layers, and layout.

1. Declare reusable sources under `<Sources>`.
2. Give each source an explicit `sourceId`.
3. Put sources in `<Scene id={...}>` with `<Layer id={...} sourceId={...}>`.
4. Use `<Box>` for Yoga layout containers.
5. Do not use boxes to make remote objects.
6. For image or media sources, refer to files with `asset(...)`.
7. Register the asset glob in the `vignette({ assets: ... })` Vite plugin options.
8. Do not write public asset URLs manually.
9. Make sure that both runtimes resolve the same content-versioned file.
10. For a typed overlay document, define a frame.
11. Put the frame in `<View>` below `SceneProvider`.

The composition describes structure.
Do not render the composition again to change content such as a title or score.
Use the remote-store data path for content changes.

Obey these library compatibility limits:

- Declare dimensions or aspect information for media.
- The library cannot get intrinsic media size asynchronously.
- The DOM supports opacity.
- OBS V1 reports and omits opacity values that are not `1`.
- Do not use one reusable browser source with different native sizes in OBS.
- Use separate source IDs when the native sizes are different.

## Add live overlay state

Use `useRemoteStore` for a value that remote controls change.
The complete data path is:

```text
POST /api/title -> validate -> store.trigger.setTitle -> persist context
  -> SSE /api/store/composition -> useRemoteStore(...) -> render in the existing frame
```

Use this procedure:

1. Define serializable state and events in the `@xstate/store` store.
2. Put the definitions in `state/composition-store.ts`.
3. Validate events with zod.
4. Keep the state shape serializable because the Durable Object persists it.
5. Give the store a typed reference in `state/store-ref.ts`.
6. Specify a stable ID, a URL, and a phantom type in the reference.

```ts
import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";

export const compositionStoreRef = defineRemoteStore<CompositionStore>({
  id: "composition",
  url: "/api/store/composition",
});
```

7. Stream snapshots from the server in `worker.tsx`.
8. Send the current snapshot immediately when a request starts.
9. Send updates until the request ends.

```ts
import { encodeRemoteStoreSnapshot } from "@strangecyan/vignette-frame/remote-store";
import { remoteStoreSnapshots } from "@strangecyan/vignette-frame/remote-store/server";

return streamSSE(c, async (stream) => {
  for await (const snapshot of remoteStoreSnapshots(store, c.req.raw.signal)) {
    await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
  }
});
```

`remoteStoreSnapshots` combines updates while a consumer is busy.
This behavior is correct for graphics because a slow client needs the newest value.
It does not need all intermediate values.
Use a different protocol when each event is necessary.
For example, use a queue for timed cues that the current state cannot fully describe.

10. Subscribe from the frame with a selector.

```tsx
import { useRemoteStore } from "@strangecyan/vignette-frame/remote-store/client";

const title = useRemoteStore(compositionStoreRef, (state) => state.context.title);
```

`EventSource` reconnects automatically.
After a reconnection, the server sends the latest state again.
The selector supplies a typed projection, but it does not compare values for equality.
Each accepted snapshot notifies each subscriber.
Add equality-aware selection for frequent updates to many independent frame components.

11. Handle hydration with a normal `Suspense` boundary.
12. Put the consumer directly below the boundary.
13. Use a transparent `null` fallback.

The hook suspends during server rendering and before the first SSE message.
The frame hydrator handles the expected recovery from server `Suspense` to client `Suspense`.
Loading or old UI must not cover program video.
Refer to `frames/title.frame.tsx`.

When you change this data path, test these conditions:

- Test the first replay.
- Test a live update without a frame reload.
- Test reconnection.
- Test an unknown store ID and make sure that it returns `404`.
- Add the necessary tests to `tests/smoke.spec.ts`.

In production, authenticate mutation endpoints and state-stream endpoints.
Read-only data can contain sensitive information.
Configure proxy buffering and idle timeouts.
Make sure that the proxy sends SSE immediately and keeps the connection open.

## Add a control route

Control routes are in the chained Hono application in `worker.tsx`.

1. Add a zod event schema next to its store event in `state/composition-store.ts`.
2. Add the route to the existing chained application with `sValidator`.
3. Keep the chained code style.
4. Trigger the store event.
5. Let the store subscription in `state/durable.ts` persist the state.
6. Use a narrow command that describes its function, such as `title`, `mode`, or a complete cue.
7. Do not expose general store writes.

The exported `CompositionApi` type supplies types to `hono/client`.
If you break the chain, you also break end-to-end type inference in `client/App.tsx`.

## Control client

`client/App.tsx` contains a control surface and a program monitor.
The control surface changes application state.
The program monitor renders the compiled scene in the same way as a runtime.

Create the runtime source one time at module scope.
Pass this stable function to `useCompositor`.
Do not call `sseRuntimeSource("/api/runtime")` inline.
An inline call makes a new transport during each render.
Repeated new transports restart the compositor.
They can cause the React maximum-update-depth error.

Obey these rules:

- Use the server store as the authoritative state.
- Do not use the preview as the authoritative state.
- A reopened client must show the current program state.
- A second operator must also see the current program state.
- Keep end-to-end API types through `hc<CompositionApi>`.
- Keep draft values off air.
- Let forms change local state.
- Send one complete cue when the operator submits the form.
- Immediate controls, such as cuts and locks, can send small patches directly.
- Do not change program output for each keystroke.
- Give each action pending, disabled, and error states.
- Prevent a second cue while the first cue is pending.
- Show `compositor.phase` and `compositor.revision` near the preview.
- Let the operator identify a deliberate black frame and an old compositor state.
- Show control responses, runtime revisions, and source returns as separate statuses.
- A successful control response means that the server persisted the command.
- A runtime revision means that a composition update reached the preview.
- A source return means that external media is flowing.
- Register the same source extensions in the preview and the destination runtime.
- For a custom OBS source, register its DOM renderer in the preview `useCompositor` call.

For a large production, add authentication and roles to each control command.
Also add an audit trail and conflict handling for simultaneous operators.
You can use sequence numbers or expected revisions for conflict handling.
Use separate preview and program buses with an explicit Take operation.
This starter controls program output directly and does not have a rehearsal bus.

## CLI preview and OBS

Use the CLI as the standard runtime tool for this starter.
Do not make an application-owned OBS process only to connect to the standard runtime SSE endpoint.

Start `pnpm dev`.
Then preview the compiled composition before you open OBS:

```sh
pnpm exec vignette preview \
  --snapshot http://127.0.0.1:5173/api/runtime \
  --name vignette-starter
```

The command saves the first scene in `vignette-preview/`.
Use `--scene <id>` to save one named scene.
Use `--all-scenes` to save all scenes.
The command shows live media and extension sources as labeled placeholders.
Use this command to examine layout and static content.
Do not use it to examine return-feed status.

Enable OBS WebSocket.
Then run:

```sh
pnpm exec vignette obs \
  --project vignette-starter \
  --obs-url ws://127.0.0.1:4455 \
  --password '<password>' \
  --url http://127.0.0.1:5173/api/runtime
```

If authentication is off, remove `--password`.
The command includes the standard built-in source codecs and the official MoQ codec.
The library runtime reconnects the command when necessary.
The command runs until it receives `SIGINT` or `SIGTERM`.
The command does not supply health or readiness endpoints.

Only manage scenes and inputs with names below `vignette::<projectId>::`.
The registry scene is also managed.
Do not manage other OBS resources.
The `--project` value must equal `COMPOSITION_PROJECT_ID` in `composition.tsx`.

Use an application-owned `OBSRuntime` only if the project needs one of these functions:

- Project-specific OBS codecs.
- Changes to built-in codec settings.
- A transport that does not use SSE.
- Custom asset storage.
- An injected OBS transport.
- Structured `getStatus()` or `whenSettled()` integration.
- A health endpoint, readiness endpoint, or process supervision contract.
- Application-specific retry, logging, metrics, or lifecycle integration.

If you use an application-owned runtime, keep the process small.
Do not put application logic in the process.
Consume runtime messages and register only necessary extensions.
Make errors and status available.
Dispose of the runtime during shutdown.
Do not read the application store.
Do not bypass the managed-namespace safety rules.

## Animate overlays

For animated graphics, use the `motion` package through `motion/react`.
Do not use the old `framer-motion` package name.

Obey these rules:

- Define one motion style with one easing family and a small duration scale.
- For example, use `const broadcastEase = [0.16, 1, 0.3, 1] as const`.
- Apply the default values one time with `<MotionConfig transition={...}>` at the overlay root.
- Control animation with semantic show state.
- Do not control animation with timers in each component.
- Give `AnimatePresence` children stable keys that describe their function.
- Use `mode="wait"` to prevent two full-screen graphics from overlapping.
- Use `initial={false}` to prevent a connected preview from repeating entrance animations.
- Use variants and `stagger()` to sequence groups.
- Do not use a separate manual delay for each child.
- Keep a complete entrance sequence shorter than approximately one second.
- Use tweens when cue time must be predictable.
- Use springs for spatial continuity with `layoutId`.
- Use short keyframes for reactions.
- Do not use continuous animation without a necessary program function.
- Keep the frame transparent.
- Animate child elements and do not put an opaque background on the root.
- Prefer `opacity` and `transform` for animation.
- Test `layout`, `layoutId`, production fonts, and large blurs on a 1920x1080 canvas.
- Use the target frame rate for these tests.
- Test cues that occur quickly one after another.
- Test exits that another cue interrupts.

Motion is live and depends on time.
Use it for lower thirds and mode transitions.
Some transitions must have an exact frame that fully covers the program.
For these transitions, use a rendered asset that OBS can use again.

## Optional stinger transitions

This starter does not include stinger transitions.
If a production needs a stinger, make a separate workspace for animation rendering.
Remotion is one possible tool.
Render a transparent media asset.
Register the output in the Vignette asset manifest.
Use explicit application state to start the stinger.

Verify these items:

- The first and last frames are transparent.
- The cut interval is fully opaque.
- Repeated playback operates correctly.
- The DOM and OBS support the asset alpha channel.

Do not put the rendering tools or generated master files in the base starter.

## Code style and tests

- Use TypeScript in all source files.
- Specify `ReactElement` return types.
- Use `readonly` state shapes.
- Put zod schemas next to the store events that they validate.
- Use Tailwind for the client user interface.
- Frames can use inline styles because they render in separate documents.
- Run smoke tests against the built Worker and the real frame and asset routes.
- Do not replace these routes with mock components in smoke tests.
- For a state-path feature, add replay, live mutation, and error tests to `apps/composition/tests/smoke.spec.ts`.
- Make sure that the live mutation test does not reload the frame.
- Give testable frame elements a `data-testid` attribute.
- Refer to `data-testid="live-title"` for an example.

## Rename a new copy

A new template copy contains the original project names.
GitHub "Use this template" and `degit` do not replace these names.
Before feature work, select an application slug, workspace package scope, and Vignette project name.

Then use this procedure:

1. Replace `cloudflare-vignette-starter` in the root `package.json` and `apps/composition/wrangler.jsonc`.
2. Use a Wrangler name that is unique in the target Cloudflare account.
3. Make sure that a deployment cannot replace a different generated project.
4. Replace `cloudflare_vignette_starter` in the composition scripts, `playwright.config.ts`, and `vite.config.ts`.
5. Use the underscore-normalized Wrangler environment name for the new application slug.
6. Keep these values equal to the environment in `dist/<environment>/wrangler.json`.
7. Replace the `@vignette-starter` package scope in each workspace `package.json` and TypeScript import.
8. Make internal dependency names and root `--filter` commands agree with the new package names.
9. Change `COMPOSITION_PROJECT_ID` in `apps/composition/src/composition.tsx`.
10. Use the same value for `vignette obs --project` in the root `obs` script.
11. Make sure that this value identifies the managed OBS namespace for the project.
12. Run `pnpm install` to update `pnpm-lock.yaml`.
13. Run `pnpm typecheck` and `pnpm test:smoke` before more changes.

After the rename, run this search:

```sh
rg 'cloudflare[-_]vignette[-_]starter|@vignette-starter|vignette-starter'
```

Examine each result for an old starter identifier.
An explanatory document can keep an intentional match.
Runtime configuration, package manifests, imports, scripts, and the lockfile must use the new names.

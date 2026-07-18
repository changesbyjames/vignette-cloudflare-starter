/**
 * Cloudflare Durable Object composition using Vignette's pull-based kernel.
 *
 *  - Frame documents are stateless edge concerns. The vignette() Vite plugin discovers
 *    `*.frame.tsx` at build time and emits `virtual:vignette/frames`: a pre-populated route registry
 *    plus a mode-appropriate module host. The worker mounts one Fetch handler; no Durable Object
 *    hop for the initial document and no hand-rolled SSR route. Hydrated frames subscribe to live
 *    application state through a separate, read-only SSE endpoint.
 *
 *  - Runtime delivery is pull-based and transport-agnostic. Setup (including the asset
 *    manifest) originates at the composer root — assets are build-derived via
 *    virtual:vignette/assets — and `root.messages(signal)` yields RuntimeMessages
 *    (setup + latest-update replay, then live). The *platform* decides what a response
 *    looks like — here, Hono's streamSSE plus the library's pure codec. Vignette never
 *    constructs a Response.
 *
 *  - The API is a typed Hono app living inside the Durable Object. Hono RPC + standard-validator
 *    give the browser client end-to-end types from the same zod schemas the store uses.
 *
 *  - The Durable Object owns three small, separately-constructible pieces:
 *      1. `store`  — app state (@xstate/store), persisted by state/durable.ts
 *      2. `scene`  — vignette's library-plumbing store (frame origin and canvas)
 *      3. `root`   — the composer; rendered exactly once, ever
 *    Scene changes flow *into* React (SceneProvider), compiled snapshots flow *out*
 *    (`root.settled()`, `root.messages()`), and app store snapshots stream directly to frames.
 */
import { sValidator } from "@hono/standard-validator";
import { toSseEvent } from "@strangecyan/vignette-core/sse";
import { createSceneStore, SceneProvider } from "@strangecyan/vignette-frame";
import { encodeRemoteStoreSnapshot } from "@strangecyan/vignette-frame/remote-store";
import { remoteStoreSnapshots } from "@strangecyan/vignette-frame/remote-store/server";
import { createFrameRequestHandler } from "@strangecyan/vignette-frame/server";
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { frames } from "virtual:vignette/frames";

import { Composition, createCompositionRoot, type CompositionRoot } from "./runtime";
import { setTitleEvent, type CompositionState, type CompositionStore } from "./state/composition-store";
import { restoreCompositionStore } from "./state/durable";
import { compositionStoreRef } from "./state/store-ref";

interface Env {
  readonly ASSETS: Fetcher;
  readonly COMPOSITION: DurableObjectNamespace<CompositionDurableObject>;
}

interface CompositionServices {
  readonly root: CompositionRoot;
  readonly scene: ReturnType<typeof createSceneStore>;
  readonly store: CompositionStore;
}

interface ApiEnv {
  readonly Variables: { readonly services: CompositionServices };
}

/**
 * Defined as a chained Hono app so the browser client can infer route inputs and responses.
 */
function createCompositionApi(
  boot: (origin: string) => Promise<CompositionServices>,
) {
  return new Hono<ApiEnv>()
    .use(async (c, next) => {
      const origin = c.req.header("X-Vignette-Origin") ?? new URL(c.req.url).origin;
      const services = await boot(origin);
      // Reactive, idempotent: a changed origin flows through <SceneProvider> and every <View>
      // re-derives its frame URL inside React. The DO does not orchestrate a re-render.
      services.scene.set({ origin });
      c.set("services", services);
      await next();
    })
    .get("/api/state", (c) => c.json(stateResponse(c.get("services"))))
    .get("/api/runtime", (c) =>
      // The platform owns the transport. The root only yields messages; the codec only formats
      // them. Replacing SSE with a WebSocket or queue is a change here, not in the library.
      streamSSE(c, async (stream) => {
        for await (const message of c.get("services").root.messages(c.req.raw.signal)) {
          await stream.writeSSE(toSseEvent(message));
        }
      }),
    )
    .get("/api/store/:ref", (c) => {
      if (c.req.param("ref") !== compositionStoreRef.id) {
        return c.json({ error: "Unknown store reference." }, 404);
      }

      return streamSSE(c, async (stream) => {
        for await (const snapshot of remoteStoreSnapshots(
          c.get("services").store,
          c.req.raw.signal,
        )) {
          await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
        }
      });
    })
    .post("/api/title", sValidator("json", setTitleEvent), async (c) => {
      const services = c.get("services");
      services.store.trigger.setTitle(c.req.valid("json"));
      return c.json(stateResponse(services));
    })
    .onError((error, c) => {
      console.error(error);
      return c.json({ error: error.message || "Composition request failed." }, 500);
    });
}

/** Exported for hono/client in the browser UI. */
export type CompositionApi = ReturnType<typeof createCompositionApi>;

export class CompositionDurableObject extends DurableObject<Env> {
  #services: Promise<CompositionServices> | undefined;
  readonly #api = createCompositionApi((origin) => this.#boot(origin));

  override fetch(request: Request): Response | Promise<Response> {
    return this.#api.fetch(request);
  }

  #boot(origin: string): Promise<CompositionServices> {
    this.#services ??= (async () => {
      const store = await restoreCompositionStore(this.ctx.storage);
      const scene = createSceneStore({ origin });
      const root = createCompositionRoot(origin, (error) =>
        console.error("Vignette composer error", error),
      );
      // The only composition render call in the program. Dynamic scene configuration arrives
      // through SceneProvider; frames subscribe to application state independently.
      await root.render(
        <SceneProvider scene={scene}>
          <Composition />
        </SceneProvider>,
      );
      return { root, scene, store };
    })();
    return this.#services;
  }
}

function stateResponse({ store, root }: CompositionServices): CompositionState & { revision: number } {
  return {
    ...store.getSnapshot().context,
    revision: root.snapshot?.revision ?? 0,
  };
}

const app = new Hono<{ Bindings: Env }>();

// Frames are served statelessly at the worker: the registry and module host were assembled at
// build time, so a frame request never wakes the Durable Object.
const handleFrame = createFrameRequestHandler(frames);
app.all("/__vignette/*", async (c) => (await handleFrame(c.req.raw)) ?? c.notFound());

app.all("/api/*", async (c) => {
  const id = c.env.COMPOSITION.idFromName("default");
  const stub = c.env.COMPOSITION.get(id);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Vignette-Origin", new URL(c.req.url).origin);
  return stub.fetch(new Request(c.req.raw, { headers }));
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

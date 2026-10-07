/**
 * Cloudflare Worker host for the composition.
 *
 *  - Frames are stateless edge routes. The vignette() Vite plugin discovers `*.frame.tsx` at build
 *    time and emits `virtual:vignette/frames`; the Worker serves them without waking the Durable
 *    Object. Hydrated frames subscribe to live application state through the remote-store route.
 *
 *  - The Durable Object owns application state (`store`, persisted by state/durable.ts) and the
 *    composer `root`, which renders exactly once. Snapshots carry root-relative frame and asset
 *    URLs, so the composer never needs to know the public origin.
 *
 *  - The platform owns the transport: `root.messages(signal)` yields stream messages (setup and
 *    latest update replay, then live updates) and Hono's streamSSE writes them with the library's
 *    codec. Replacing SSE with a WebSocket or queue is a change here, not in the library.
 *
 *  - The API is a chained Hono app so `hono/client` infers routes from the same zod schemas.
 */
import { sValidator } from "@hono/standard-validator";
import { createComposerRoot, type ComposerRoot } from "@strangecyan/vignette";
import { toSseEvent } from "@strangecyan/vignette-core/sse";
import { encodeRemoteStoreSnapshot } from "@strangecyan/vignette-frame/remote-store";
import { remoteStoreSnapshots } from "@strangecyan/vignette-frame/remote-store/server";
import { createFrameRequestHandler } from "@strangecyan/vignette-frame/server";
import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { assets } from "virtual:vignette/assets";
import { frames } from "virtual:vignette/frames";

import { composition } from "./composition";
import { setTitleEvent, type CompositionState, type CompositionStore } from "./state/composition-store";
import { restoreCompositionStore } from "./state/durable";
import { compositionStoreRef } from "./state/store-ref";

interface Env {
  readonly ASSETS: Fetcher;
  readonly COMPOSITION: DurableObjectNamespace<CompositionDurableObject>;
}

interface CompositionServices {
  readonly root: ComposerRoot;
  readonly store: CompositionStore;
}

interface ApiEnv {
  readonly Variables: { readonly services: CompositionServices };
}

function createCompositionApi(boot: () => Promise<CompositionServices>) {
  const api = new Hono<ApiEnv>()
    .use(async (c, next) => {
      c.set("services", await boot());
      await next();
    })
    .get("/api/state", (c) => c.json(stateResponse(c.get("services"))))
    .get("/api/stream", (c) =>
      streamSSE(c, async (stream) => {
        for await (const message of c.get("services").root.messages(c.req.raw.signal)) {
          await stream.writeSSE(toSseEvent(message));
        }
      }),
    )
    .post("/api/title", sValidator("json", setTitleEvent), async (c) => {
      const services = c.get("services");
      services.store.trigger.setTitle(c.req.valid("json"));
      return c.json(stateResponse(services));
    })
    .onError((error, c) => {
      console.error(error);
      return c.json({ error: error.message || "Composition request failed." }, 500);
    });

  // Frames read this feed with EventSource rather than hono/client, so it stays out of the typed chain.
  api.get(compositionStoreRef.url, (c) =>
    streamSSE(c, async (stream) => {
      for await (const snapshot of remoteStoreSnapshots(c.get("services").store, c.req.raw.signal)) {
        await stream.writeSSE({ data: encodeRemoteStoreSnapshot(snapshot) });
      }
    }),
  );
  return api;
}

/** Exported for hono/client in the browser UI. */
export type CompositionApi = ReturnType<typeof createCompositionApi>;

export class CompositionDurableObject extends DurableObject<Env> {
  #services: Promise<CompositionServices> | undefined;
  readonly #api = createCompositionApi(() => this.#boot());

  override fetch(request: Request): Response | Promise<Response> {
    return this.#api.fetch(request);
  }

  #boot(): Promise<CompositionServices> {
    this.#services ??= (async () => {
      const store = await restoreCompositionStore(this.ctx.storage);
      const root = createComposerRoot(composition, {
        assets,
        onError: (error) => console.error("Vignette composer error", error),
      });
      // The only render call in the program; frames subscribe to application state independently.
      await root.render();
      return { root, store };
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
const toDurableObject = (request: Request, env: Env) =>
  env.COMPOSITION.getByName("default").fetch(request);

// Stateful routes go to the Durable Object; the store route precedes the stateless frame routes.
app.all("/api/*", (c) => toDurableObject(c.req.raw, c.env));
app.get(compositionStoreRef.url, (c) => toDurableObject(c.req.raw, c.env));

const handleFrame = createFrameRequestHandler(frames);
app.all("/__vignette/*", async (c) => (await handleFrame(c.req.raw)) ?? c.notFound());

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

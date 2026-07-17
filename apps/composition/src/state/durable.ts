/**
 * Durable Object persistence for the composition store.
 *
 * Hydrate once, then mirror every committed context back to storage. The DO's output gate makes
 * fire-and-forget `put()` safe: a response is not released to the client until pending writes
 * are durable, so `trigger.setTitle() -> respond` keeps read-your-writes without explicit awaits
 * or a mutation queue.
 */
import {
  createCompositionStore,
  defaultCompositionState,
  type CompositionState,
  type CompositionStore,
} from "./composition-store";

const STATE_KEY = "state";

export async function restoreCompositionStore(
  storage: DurableObjectStorage,
): Promise<CompositionStore> {
  const persisted = await storage.get<CompositionState>(STATE_KEY);
  const store = createCompositionStore(persisted ?? defaultCompositionState());
  store.subscribe((snapshot) => {
    void storage.put(STATE_KEY, snapshot.context);
  });
  return store;
}

import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";
import type { CompositionStore } from "./composition-store";

/** Served at `compositionStoreRef.url` (`/__vignette/store/composition`). */
export const compositionStoreRef = defineRemoteStore<CompositionStore>({ id: "composition" });

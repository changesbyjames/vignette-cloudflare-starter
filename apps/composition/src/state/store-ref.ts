import { defineRemoteStore } from "@strangecyan/vignette-frame/remote-store";
import type { CompositionStore } from "./composition-store";

export const compositionStoreRef = defineRemoteStore<CompositionStore>({
  id: "composition",
  url: "/api/store/composition",
});

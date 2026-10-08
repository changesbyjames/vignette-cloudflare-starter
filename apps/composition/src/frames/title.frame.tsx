import { frame } from "@strangecyan/vignette-frame";
import { useRemoteStore } from "@strangecyan/vignette-frame/remote-store/client";
import type { ReactElement } from "react";

import { compositionStoreRef } from "../state/store-ref";

// Frames render beneath a root `<Suspense fallback={null}>`, so the transparent frame stays empty
// until the first store snapshot arrives instead of covering program video with a loading state.
function Title(): ReactElement {
  const title = useRemoteStore(compositionStoreRef, (state) => state.context.title);

  return (
    <div
      data-testid="live-title"
      style={{
        display: "grid",
        width: "100%",
        height: "100%",
        placeItems: "center",
        color: "white",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: 96,
        fontWeight: 600,
      }}
    >
      {title}
    </div>
  );
}

export const titleFrame = frame({ view: Title });

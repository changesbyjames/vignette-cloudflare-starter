import { frame } from "@cbj/vignette-frame";
import { useRemoteStore } from "@cbj/vignette-frame/remote-store/client";
import { Suspense, type ReactElement } from "react";
import { z } from "zod";

import { compositionStoreRef } from "../state/store-ref";

const titleParams = z.object({});

function Title(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LiveTitle />
    </Suspense>
  );
}

function LiveTitle(): ReactElement {
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

export const titleFrame = frame({ params: titleParams, view: Title });

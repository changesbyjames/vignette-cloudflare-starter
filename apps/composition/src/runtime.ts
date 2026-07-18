import { createComposerRoot } from "@strangecyan/vignette";
import { yogaLayoutEngine } from "@strangecyan/vignette-core/layout-yoga";
import { assets } from "virtual:vignette/assets";

import { COMPOSITION_CANVAS, COMPOSITION_PROJECT_ID, Composition } from "./composition";

export { Composition };

/**
 * ComposerRoot owns the asset manifest and exposes pull-based members so hosts never
 * re-implement fan-out:
 *
 *   settled(): Promise<CompiledSnapshot>            // resolves after pending updates commit
 *   snapshot:  CompiledSnapshot | undefined         // latest committed snapshot
 *   snapshots(signal?): AsyncIterable<CompiledSnapshot>
 *   messages(signal?): AsyncIterable<RuntimeMessage> // setup (from `assets`) + updates
 *
 * Because setup originates here, no separate hub object exists: messages() replays
 * setup + the latest update per subscriber. subscribe(callback) remains for push-style
 * consumers.
 */
export type CompositionRoot = ReturnType<typeof createComposerRoot>;

export function createCompositionRoot(
  origin: string,
  onError: (error: Error) => void,
): CompositionRoot {
  return createComposerRoot({
    projectId: COMPOSITION_PROJECT_ID,
    canvas: COMPOSITION_CANVAS,
    layoutEngine: yogaLayoutEngine,
    // The build already knows every fingerprinted asset the composition imports; nothing is
    // hand-maintained. Dynamic assets (R2, CMS) could be appended here: [...assets.assets, ...]
    assets: {
      ...assets,
      assets: assets.assets.map((entry) => ({
        ...entry,
        url: new URL(entry.url, origin).href,
      })),
    },
    onError,
  });
}

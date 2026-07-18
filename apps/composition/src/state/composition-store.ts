import { createStore } from "@xstate/store";
import { z } from "zod";

export interface CompositionState {
  readonly title: string;
  readonly updatedAt: string;
}

export const setTitleEvent = z.object({
  title: z.string().trim().min(1).max(80),
});

export type SetTitleEvent = z.infer<typeof setTitleEvent>;

export function defaultCompositionState(): CompositionState {
  return {
    title: "Hello, Vignette!",
    updatedAt: new Date().toISOString(),
  };
}

export function createCompositionStore(initial: CompositionState) {
  return createStore({
    context: initial,
    on: {
      setTitle: (_context, event: SetTitleEvent): CompositionState => ({
        ..._context,
        title: event.title,
        updatedAt: new Date().toISOString(),
      }),
    },
  });
}

export type CompositionStore = ReturnType<typeof createCompositionStore>;

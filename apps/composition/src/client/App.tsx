import { sseRuntimeSource, useCompositor } from "@cbj/vignette-target-dom/react";
import { hc, type InferResponseType } from "hono/client";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import type { CompositionApi } from "../worker";

const client = hc<CompositionApi>("/");
type CompositionSnapshot = InferResponseType<typeof client.api.state.$get>;

export function App(): ReactElement {
  const [state, setState] = useState<CompositionSnapshot>();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [stageRef, compositor] = useCompositor({
    sceneId: "main",
    transport: sseRuntimeSource("/api/runtime"),
    onError: (cause) => setError(cause.message),
  });

  useEffect(() => {
    const controller = new AbortController();
    void client.api.state
      .$get(undefined, { init: { signal: controller.signal } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the composition state.");
        const snapshot = await response.json();
        setState(snapshot);
        setTitle(snapshot.title);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not load the composition.");
        }
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await client.api.title.$post({ json: { title } });
      if (!response.ok) throw new Error("Could not update the title.");
      setState(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the title.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-950 px-5 py-10 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h1 className="text-xl font-semibold">Vignette composition</h1>
            <span className="font-mono text-xs text-slate-400">
              {compositor.phase} / rev {compositor.revision}
            </span>
          </div>
          <div className="overflow-hidden border border-white/15 bg-black shadow-2xl">
            <div ref={stageRef} className="aspect-video w-full" data-testid="stage" />
          </div>
        </section>

        <form className="self-start border border-white/10 bg-white/5 p-5" onSubmit={(event) => void submit(event)}>
          <label className="block text-sm font-medium" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="mt-2 w-full border border-white/15 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-400"
            value={title}
            maxLength={80}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
          <button
            type="submit"
            className="mt-3 w-full bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
            disabled={pending || state === undefined}
          >
            {pending ? "Updating..." : "Update composition"}
          </button>
          {error !== undefined && <p className="mt-3 text-sm text-red-300">{error}</p>}
          {state !== undefined && (
            <p className="mt-4 font-mono text-xs text-slate-500">
              Updated {new Date(state.updatedAt).toLocaleTimeString()}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

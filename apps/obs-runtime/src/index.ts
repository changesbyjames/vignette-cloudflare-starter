import { projectId } from "@cbj/vignette-core";
import { consumeRuntimeMessages } from "@cbj/vignette-core/runtime";
import { OBSRuntime, sseRuntimeSource } from "@cbj/vignette-target-obs";
import { COMPOSITION_PROJECT_NAME } from "@vignette-starter/composition-config";
import { createServer } from "node:http";
import process from "node:process";

const obsUrl = process.env.OBS_URL ?? "ws://127.0.0.1:4455";
const obsPassword = process.env.OBS_PASSWORD ?? "";
const runtimeUrl = process.env.COMPOSITION_RUNTIME_URL ?? "http://127.0.0.1:5173/api/runtime";
const port = readPort(process.env.OBS_RUNTIME_PORT);
const controller = new AbortController();
const reportError = (error: Error): void => console.error(error.stack ?? error.message);

const runtime = new OBSRuntime({
  id: "vignette-obs",
  projectId: projectId(COMPOSITION_PROJECT_NAME),
  url: obsUrl,
  password: obsPassword,
  onError: reportError,
});

const server = createServer((request, response) => {
  if (request.url !== "/" && request.url !== "/health") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const status = runtime.getStatus();
  response.writeHead(status.phase === "error" ? 503 : 200, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  response.end(
    JSON.stringify({
      service: "vignette-obs-runtime",
      runtimeUrl,
      obsUrl,
      ...status,
    }),
  );
});

const shutdown = (): void => controller.abort();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  console.log(`OBS runtime health server listening on http://127.0.0.1:${String(port)}/health`);
  console.log(`Consuming ${runtimeUrl}`);
  console.log(`Connecting to ${obsUrl}`);
});

try {
  await consumeRuntimeMessages(
    runtime,
    sseRuntimeSource(runtimeUrl, { onError: reportError })(controller.signal),
  );
} finally {
  await runtime.dispose();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? "4174");
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("OBS_RUNTIME_PORT must be a valid TCP port.");
  }
  return parsed;
}

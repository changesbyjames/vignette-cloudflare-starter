import { expect, test } from "@playwright/test";
import { readdir } from "node:fs/promises";

test("serves frames before Durable Object state and provides read-your-writes", async ({
  page,
  request,
}) => {
  const props = encodeURIComponent(JSON.stringify({}));
  const frameAssets = await readdir(
    new URL("../dist/client/assets/vignette/frame/", import.meta.url),
  );
  const frameAsset = frameAssets.find((name) => /^titleframe-[a-z0-9]+\.js$/u.test(name));
  expect(frameAsset, "built title frame entry").toBeDefined();
  if (frameAsset === undefined) throw new Error("Built title frame entry is missing.");
  const framePath = `/__vignette/frame/${frameAsset.slice(0, -".js".length)}?props=${props}`;
  const frame = await request.get(framePath);
  expect(frame.status()).toBe(200);
  expect(await frame.text()).toContain("data-vignette-frame-root");

  const initial = await request.get("/api/state");
  expect(initial.status()).toBe(200);
  const before = (await initial.json()) as { readonly revision: number };

  await page.goto("/api/state");
  const replay = await page.evaluate(async () => {
    const controller = new AbortController();
    const response = await fetch("/api/runtime", { signal: controller.signal });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (reader !== undefined && !text.includes("event: update")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    controller.abort();
    return text;
  });
  expect(replay).toContain("event: setup");
  expect(replay).toContain("event: update");

  const title = `Smoke test ${String(Date.now())}`;
  const update = await request.post("/api/title", { data: { title } });
  expect(update.status()).toBe(200);
  const after = (await update.json()) as { readonly revision: number; readonly title: string };
  expect(after.revision).toBe(before.revision);
  expect(after.title).toBe(title);

  const current = await request.get("/api/state");
  expect(((await current.json()) as { readonly title: string }).title).toBe(title);

  await page.goto(framePath);
  await expect(page.getByTestId("live-title")).toHaveText(title);
  const marker = await page.evaluate(() => {
    const value = crypto.randomUUID();
    document.documentElement.dataset.frameMarker = value;
    return value;
  });

  const nextTitle = `Live update ${String(Date.now())}`;
  expect((await request.post("/api/title", { data: { title: nextTitle } })).status()).toBe(200);
  await expect(page.getByTestId("live-title")).toHaveText(nextTitle);
  expect(
    await page.evaluate(() => document.documentElement.dataset.frameMarker),
  ).toBe(marker);
});

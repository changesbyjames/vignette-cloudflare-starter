# Cloudflare Vignette starter

A minimal pnpm workspace for a React-authored Vignette composition hosted by a Cloudflare Worker.
A Durable Object persists composition state and publishes the composer stream over SSE. The
Vignette CLI previews compiled scenes and applies the stream to OBS.

## Workspace

```text
apps/
  composition/        Cloudflare Worker, Durable Object, frame, and browser client
```

The example composition has one color source, one scene, and one generated title frame. Its single
persisted `title` value demonstrates the complete state path without adding an application-specific
domain model.

## Create from GitHub

On GitHub, select **Use this template**, then **Create a new repository**. Clone the new repository
and install its dependencies:

```sh
git clone <new-repository-url> my-vignette-app
cd my-vignette-app
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The generated repository starts with its own Git history and keeps no link to the starter repository.

## Run the composition

The starter requires Node.js 22 or newer and pnpm 11. Enable Corepack once if needed:

```sh
corepack enable
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

The browser client and API are available at `http://127.0.0.1:5173`; the composer stream is
`/api/stream`.

## Preview the composition

With `pnpm dev` running, capture the first compiled scene as a PNG:

```sh
pnpm exec vignette preview \
  --snapshot http://127.0.0.1:5173/api/stream \
  --name vignette-starter
```

The file is written under `vignette-preview/`. Use `--scene <id>` to select a scene or
`--all-scenes` to capture every scene.

## Run in OBS

Enable OBS WebSocket, keep `pnpm dev` running, and start the standard Vignette OBS runtime:

```sh
pnpm exec vignette obs \
  --project vignette-starter \
  --obs-url ws://127.0.0.1:4455 \
  --password 'your-obs-websocket-password' \
  --url http://127.0.0.1:5173/api/stream
```

`--project` must equal the composition's `id` in `composition.tsx`; the runtime refuses a stream for
any other project. Omit `--password` when OBS WebSocket authentication is disabled. Frame and asset
URLs in snapshots are root-relative and resolve against `--url`; add `--browser-source-base-url`
only when OBS reaches the Worker at a different address than the CLI (for example, from Docker).
The command runs until interrupted and intentionally has no health endpoint or readiness API.

For the starter defaults, use the root script:

```sh
pnpm obs
# With authentication:
pnpm obs -- --password 'your-obs-websocket-password'
```

## Commands

- `pnpm dev`: build and run the Cloudflare composition locally.
- `pnpm exec vignette preview ...`: capture compiled scenes as PNGs.
- `pnpm exec vignette obs ...`: stream the composition into OBS.
- `pnpm obs`: run the OBS CLI with this starter's project and local URLs.
- `pnpm typecheck`: typecheck every workspace package.
- `pnpm build`: build the Worker and browser assets.
- `pnpm test:smoke`: test frame serving, state, SSE replay, and mutation.
- `pnpm deploy`: build and deploy the Worker.

## Plumbing

- `vite.config.ts` installs the Vignette, React, Tailwind, and Cloudflare plugins. The Vignette
  plugin supplies the React and Yoga Vite defaults, and Vignette's `workerd` build loads Yoga in
  the Worker without extra configuration.
- `composition.tsx` exports `composition` from `defineComposition`: the project ID, canvas, and
  top-level component.
- `*.frame.tsx` files are discovered by Vignette and served outside the Durable Object.
- The Durable Object restores an XState store, calls `createComposerRoot(composition, { assets })`,
  and renders once per instance.
- Hono exposes typed state and mutation routes, the `/api/stream` composer stream, and the
  `/__vignette/store/composition` remote-store feed.
- The browser renders the stream with `useStage`; the Vignette CLI supplies the default OBS runtime.
- Only serializable application state is persisted. React and Vignette runtime objects are rebuilt
  when a Durable Object instance starts.

Start customization in `apps/composition/src/composition.tsx` and
`apps/composition/src/state/composition-store.ts`. Keep the composition `id` in `composition.tsx`
consistent with the `vignette obs --project` argument in the root script.

## License

MIT

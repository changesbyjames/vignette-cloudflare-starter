# Cloudflare Vignette starter

A minimal pnpm workspace for a React-authored Vignette composition hosted by a Cloudflare Worker.
A Durable Object persists composition state and publishes runtime updates over SSE. A separate Node
runtime consumes those updates and applies them to OBS.

## Workspace

```text
apps/
  composition/        Cloudflare Worker, Durable Object, frame, and browser client
  obs-runtime/        Separate Node process that connects the composition to OBS
packages/
  composition-config/ Shared project identity used by both runtimes
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
pnpm dev
```

The browser client and runtime API are available at `http://127.0.0.1:5173`.

## Run the OBS runtime

Enable OBS WebSocket, then configure the separate runtime from `apps/obs-runtime/.env.example`:

```sh
OBS_URL=ws://127.0.0.1:4455 \
OBS_PASSWORD='your-obs-websocket-password' \
COMPOSITION_RUNTIME_URL=http://127.0.0.1:5173/api/runtime \
pnpm obs
```

Health information is available at `http://127.0.0.1:4174/health`. `OBS_RUNTIME_PORT` changes that
port.

## Commands

- `pnpm dev`: build and run the Cloudflare composition locally.
- `pnpm obs`: run the separate Node OBS runtime.
- `pnpm typecheck`: typecheck every workspace package.
- `pnpm build`: build the Worker and browser assets.
- `pnpm test:smoke`: test frame serving, state, SSE replay, and mutation.
- `pnpm deploy`: build and deploy the Worker.

## Plumbing

- `vite.config.ts` installs Vignette, React, Tailwind, Cloudflare, and Worker Yoga plugins.
- `*.frame.tsx` files are discovered by Vignette and served outside the Durable Object.
- The Durable Object restores an XState store, creates the scene store and composer root, and renders
  React once per instance.
- Hono exposes typed state, mutation, and SSE runtime routes.
- The browser uses the DOM compositor; the separate Node package uses the OBS runtime.
- Only serializable application state is persisted. React and Vignette runtime objects are rebuilt
  when a Durable Object instance starts.

Start customization in `apps/composition/src/composition.tsx` and
`apps/composition/src/state/composition-store.ts`. Keep the shared project name in
`packages/composition-config/src/index.ts` consistent across runtimes.

## License

MIT

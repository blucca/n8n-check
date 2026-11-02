# Production deployment

Use Node.js 22.22+ and keep the adjacent `../experiments/lineage-boundary/`
auditor, `backtracking.cjs`, and four synthetic `recorded/*.json` samples.
The server imports this existing auditor; there is one audit implementation.

```sh
npm install
npm run build
# Set the server environment from a private file, then:
HOST=127.0.0.1 PORT=8100 npm start
```

The build runs the official `agent-native build` doctor/client pipeline and
the pinned SDK's official Nitro deployment pipeline. The legacy SPA client
is emitted into `build/client`, which Nitro includes in `.output/public`.
The production entry point is `.output/server/index.mjs`; this self-contained
Nitro output also runs with `node .output/server/index.mjs`.

Production native application state uses PostgreSQL. Supply `DATABASE_URL`
and a random `BETTER_AUTH_SECRET` through a server-only environment file.
Local `npm run dev` uses PGlite. `AUTH_DISABLED=true` exposes one shared
synthetic demonstration workspace, using the same `AGENT_USER_EMAIL` for
human, CLI, HTTP and agent state. Keep `OPENROUTER_API_KEY` on the server.

Bind Node and PostgreSQL to loopback and publish the Node port with a
Cloudflare Tunnel. A Quick Tunnel URL follows its running tunnel process;
save the current URL when restarting the tunnel. The live demo runs on a persistent Linux host with enabled user systemd
services for Node, PostgreSQL and tunnel. Its shared PostgreSQL state is
preserved across host migrations.

The public demo serves synthetic samples. Host real execution exports in a
separate authenticated private instance: set `runtime.auth.enabled` to `true`
and remove `AUTH_DISABLED` from that server environment.

# Context Edge

Development workspace for the Context Markets dashboard and indexer.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Foundry (for `forge build`)

## One-time setup

```bash
# Install dependencies (requires network access)
pnpm install

# Build contract artifacts so ABIs are available
cd contracts && forge build && cd ..

# Copy verified ABIs into the web and indexer apps
pnpm copy-abis
```

> Tip: Re-run `pnpm copy-abis` whenever you rebuild the contracts to keep the generated ABIs in sync.

Environment files are pre-populated for Base mainnet deployments:

- `apps/indexer/.env`
- `apps/web/.env.local`

Key indexer settings live in `apps/indexer/.env`:
- `LOOKBACK_DAYS` to control the historical window (defaults to 14)
- `CONTEXT_BASE` and `PROFILE_SCRAPE` enable automatic profile enrichment

## Running the stack

```bash
# Terminal 1 – viem/SQLite indexer
pnpm --filter apps/indexer dev

# Terminal 2 – Next.js dashboard
pnpm --filter apps/web dev
```

The indexer writes to `data/context-edge.db`. The web app reads from the same path for API routes and page rendering.

## Generated artifacts

- `scripts/copy-abis.js` keeps ABIs in sync with `contracts/out`
- `apps/indexer` contains the viem-based indexer (poller + log processing)
- `apps/web` is a Tailwind-styled single-page dashboard (App Router)

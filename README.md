# Context Edge Dashboard

Server-rendered dashboard for Context Markets. Surfaces real boost, TVL, ROI and wallet stats straight from the local SQLite snapshot.

## Prerequisites

- Node.js 18+
- pnpm 8+
- SQLite database exported by the Context indexer (`data/context.db` in this repo)

## Install & Run

```bash
pnpm install
pnpm --filter apps/web dev
```

By default the web app reads `../../data/context.db`. Override with `SQLITE_PATH` / `BK_DB` in `apps/web/.env.local` if your database lives elsewhere. Set `BK_ME` to a wallet address to enable the user drawer.

## Features (v0.2)

- **Markets panel** – Ranks markets by outstanding boost and TVL, shows 24h volume, edge score, latest price, and the largest YES/NO holders (with platform ROI rank pulled from the leaderboard).
- **ROI-weighted leaderboard** – Top 50 wallets by `(PnL + rewards) × log10(capital)` including raw capital at risk, rewards, volume, trade count, and ROI%.
- **Recent activity rail** – Last eight boosts, trades, or reward claims within the selected range.
- **User drawer** – Slide-out snapshot for the configured `BK_ME` wallet (capital, boosts, PnL, rewards, ROI rank).

Everything renders on the server against the SQLite file—no background polling or brittle remote fetches.

## Environment Variables (`apps/web/.env.local`)

| Variable      | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `SQLITE_PATH` | Absolute/relative path to the SQLite database (default `../../data/context.db`) |
| `BK_DB`       | Alternative alias for the same database path                  |
| `BK_ME`       | Wallet address to populate the user drawer                    |
| `RPC_URL`     | Base RPC endpoint (set in `.env.local`, keep private)         |

Store private keys and RPC URLs in `apps/web/.env.private` (gitignored) and, if needed, mirror the non-sensitive entries into `.env.local` for local development.

## Validation

Spot-check the data layer with the existing snapshot:

```bash
# Top markets by boost
sqlite3 data/context.db "SELECT marketId, SUM(CAST(usdcIn AS INTEGER))-SUM(CAST(usdcOut AS INTEGER)) AS net FROM trades GROUP BY marketId ORDER BY net DESC LIMIT 5;"

# Wallet ROI components
sqlite3 data/context.db "SELECT lower(trader) addr, SUM(CAST(usdcOut AS INTEGER))-SUM(CAST(usdcIn AS INTEGER)) pnl FROM trades GROUP BY addr ORDER BY pnl DESC LIMIT 5;"
```

Refer to [`docs/dashboard.md`](./docs/dashboard.md) for a deeper explanation of the calculations and response shapes.

## Test Instrumentation & ABI Preflight

The web test suite now fails closed. Every run verifies on-chain ABIs, copies them into the app, and points Vitest at a deterministic SQLite fixture. Run the following from repo root:

```bash
# 1. Fetch & verify ABIs, then copy them into apps/web/src/abi
export BASESCAN_KEY=...   # or ETHERSCAN_KEY
pnpm fetch-abi
pnpm verify-abi

# 2. Run the web test suite (setup.ts assigns DB_PATH to the fixture)
pnpm --filter context-edge-web test
```

During the test run you should see logs similar to:

```
[vitest] DB_PATH = /path/to/apps/web/tests/fixtures/context.test.sqlite
```

If the fixture is missing the setup script warns but the tests continue against the fallback database. Populate `apps/web/tests/fixtures/context.test.sqlite` with the minimal tables used in `tests/dashboard.test.ts` (`trades`, `identity_map`, `locks`) to reproduce the production calculations locally.

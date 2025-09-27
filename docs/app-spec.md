# Betkiller Dash — App Specification

## Overview

Betkiller Dash is a mono-repo workspace that combines:

1. **Indexer (`apps/indexer`)** – a viem + ethers powered pipeline that ingests Context Markets activity (markets, trades, boosts, rewards) from Base mainnet, normalises the data into SQLite, captures market TVL snapshots, and enriches wallet identities via context.markets profile fetches.
2. **Dashboard (`apps/web`)** – a Next.js App Router application (Tailwind with `bk-` prefix) that reads from the same SQLite database and surfaces live insights for traders, creators, and boosters.

The system maintains a rolling 14-day history by default (`LOOKBACK_DAYS`).

## Indexer Components

- **Chain sources**: `PredictionMarket`, `Vault`, `RewardDistributor` contracts on Base mainnet.
- **Events consumed**:
  - `MarketCreated`, `MarketTraded`, `MarketResolved` (market lifecycle + liquidity changes)
  - `MarketTraded` → net USDC flow per trader
  - `LockUpdated`, `StakeUpdated`, `Unlocked`, `SponsoredLocked` from `Vault`
  - `RewardClaimed`, `EpochRootSet` from `RewardDistributor`
- **State snapshots**: after any market trade/create, a call to `getMarketInfo` captures `totalUsdcIn`, aggregate outcome quantities, and `alpha`, storing in `market_state`.
- **Profile enrichment**: resolves display names and X handles through Context’s API/HTML, cached for 24h. Controlled by `PROFILE_SCRAPE`, `PROFILE_TTL_SECONDS`, `PROFILE_CONCURRENCY`.
- **Backoff**: all RPC calls go through exponential retry (`RPC_MAX_ATTEMPTS`, `RPC_RETRY_DELAY_MS`).

### SQLite schema (key tables)

- `markets` – metadata, creator/oracle/surplus info.
- `trades` – per trader per trade net USDC in/out and hashes.
- `locks` – vault interactions (+ payload for boosts).
- `rewards` – reward claims and buckets.
- `impact` – cost-to-move precomputations.
- `processed_logs` – contract/log dedupe ledger (`contract` + `txHash` + `logIndex`).
- `market_state` – TVL snapshots per market over time.
- `profiles` – `address`, `display_name`, `x_handle`, `last_seen`.

## Dashboard Features

- **KPIs** – bankroll, 24h PnL, 24h rewards, open risk (boost exposure).
- **Live Slate** – top actionable markets with TVL, boost totals, 24h volume, trader count, and computed edge score.
- **Action Bar** – highlights top three suggestions from the slate.
- **Leaderboards** – toggle ranges (24h/7d/14d) and buckets (Total, Creator, Booster, Trader, Efficiency).
- **PnL Table** – wallet reward + net flow + combined PnL sorted by profitability.
- **My Rewards** – bucketed split (Creator/Booster/Trader) for the configured `BK_ME` wallet.
- **Near Resolution** – markets resolving in the next 72 hours.
- **Competitor Watch** – top wallets’ recent markets and associated boost totals.
- **Event Log & Errors** – recent reward claims and vault actions plus runtime warnings.

### API routes (App Router)

- `GET /api/leaderboard?range=24h|7d|14d&by=total|creator|booster|trader|eff`
- `GET /api/pnl?range=24h|7d|14d`
- `GET /api/live-slate`
- `GET /api/near-resolution`
- `GET /api/me/summary?range=...`
- `GET /api/competitor-watch`

Each endpoint reads from SQLite using prepared statements in `apps/web/lib/db.ts`.

## Environment Variables

### Indexer (`apps/indexer/.env`)

| Variable | Purpose |
| --- | --- |
| `BASE_RPC` | Base mainnet RPC URL |
| `LOOKBACK_DAYS` | Rolling history window (default 14) |
| `CONTEXT_BASE` | Base URL for profile scraping |
| `PROFILE_SCRAPE` | Toggle profile fetcher |
| `PROFILE_TTL_SECONDS` | Cache duration for profile data |
| `PROFILE_CONCURRENCY` | Parallel profile fetches |
| `RPC_MAX_ATTEMPTS` | Max RPC retries |
| `RPC_RETRY_DELAY_MS` | Initial retry delay (exponential) |
| `RPC_URLS` | Comma-separated Base RPC endpoints for the indexer pool |
| `RPC_QPS` | Target aggregate requests per second across RPC URLs |
| `RPC_MAX_RETRIES` | Max attempts before surfacing an RPC failure |
| `RPC_TIMEOUT_MS` | Deadline per RPC call before retrying |
| `LOG_INIT_SPAN` | Initial block span for adaptive log scanning |
| `LOG_MAX_SPAN` | Ceiling block span when log fetches succeed |
| `LOG_MIN_SPAN` | Floor block span when providers cap results |
| `REALTIME_HANDOFF_DEPTH` | Blocks to leave for realtime watcher handoff (default 2) |
| `BLOCK_POLL_INTERVAL` | Milliseconds between block watcher polls (default 4000) |

### Dashboard (`apps/web/.env.local`)

| Variable | Purpose |
| --- | --- |
| `BK_DB` | Path to SQLite database |
| `BK_ME` | Wallet for personal analytics |
| `NEXT_PUBLIC_BASE_URL` | Base URL for client-side fetches |

## Runbook

1. Install dependencies: `pnpm install`
2. Build contracts & export ABIs: `cd contracts && forge build && cd .. && pnpm copy-abis`
3. Start indexer: `pnpm --filter context-edge-indexer dev`
4. Start dashboard: `pnpm --filter apps/web dev`

## Known Limitations

- Only the most recent `LOOKBACK_DAYS` of history is retained.
- PnL is net rewards + trade flows; it does not account for unrealised positions.
- X handle and display name availability depends on Context leaderboards; missing profiles fall back to short addresses.
- RPC rate limits depend on the upstream Base provider; tuning `RPC_MAX_ATTEMPTS` and delay may be necessary for public endpoints.

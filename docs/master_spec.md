# BetKiller — Master Specification (v2)

> **Source of truth.** Mirrors the current implementation across indexer + web, tracks design decisions, and lists remaining work.

---

## 1. Product Goals & Invariants

- **Chain of record:** Base Mainnet (chain id 8453). On-chain truth only from Context contracts: `PredictionMarket`, `Vault`, `RewardDistributor`, `USDC`.
- **History policy:** Backfill exactly the last 14 days on first boot, then ingest forward forever. Never delete or mutate past rows.
- **Idempotent & resumable:** Log ingestion keyed by `(contract, txHash, logIndex)`. Re-org safety via `CONFIRMATIONS` (default 8).
- **No synthetic data:** decode-or-drop. Un-decoded events are logged but not persisted.
- **Config via env:** RPC keys, distributor address, etc live in environment variables (no secrets in git).
- **UX defaults:** Dashboard defaults to 24h window out of the box; users can pivot to 7d or 30d ranges. (14d backfill exists strictly for bootstrap, not as a selectable window.)

---

## 2. Architecture

```
apps/indexer (Node 20 + TypeScript + ethers/viem) ──► SQLite (WAL)
apps/web     (Next.js 14 App Router + Tailwind bk- prefix) ─┘
```

- **Indexer runtime:** `apps/indexer/src/index.ts` orchestrates log polling, adaptive batch sizing, and nightly re-snapshots. Lightweight HTTP server (`src/server/index.ts`) exposes `/health` and `/rewards/:address` for the web tier.
- **Web runtime:** `apps/web` uses server components + route handlers (`app/api/**`) to query SQLite read-only. Design tokens live in `styles/tokens.css` (dark-only Context palette).
- **Test runner:** Vitest (ESM entrypoint) covers helper logic; no Vite build pipeline is bundled with the project.
- **Shared DB:** `better-sqlite3` read/write for indexer, read-only for web (path configurable via `BK_DB`).

---

## 3. Data Model (SQLite)

| Table | Purpose | Key Columns |
| --- | --- | --- |
| `markets` | Market metadata (creator/oracle/surplus/questionId/outcome names, metadata blob, createdAt/tx) | `marketId` PK |
| `trades` | Trader cashflows per trade (`usdcIn/out`), volume aggregation inputs | `(txHash, logIndex)` PK |
| `locks` | Vault locks/unlocks with payload JSON for boosts | `(txHash, logIndex)` |
| `sponsored_locks` | Boost subsidies with detailed cost breakout | `(txHash, logIndex)` |
| `stakes` | StakeUpdated events | `(txHash, logIndex)` |
| `resolutions` | Market resolution snapshots (`payoutJson`, surplus) | `marketId` PK |
| `redemptions` | TokensRedeemed history | `(txHash, logIndex)` |
| `impact` | Cost-to-move snapshots (`usdcClip`, `deltaProb`) | `id` auto |
| `market_state` | TVL snapshots (`totalUsdc`, `totalQ`, `alpha`) | `id` auto |
| `rewards` | Raw reward events (roots + legacy claims) | `id` auto |
| `reward_epochs` | Active distributor epochs (root + blockTime) | `epoch_id` PK |
| `reward_claims` | Wallet reward claims (micro USDC, tx hash, block time) | `(epoch_id, wallet)` PK |
| `profiles` | Context user enrichment (display name, X handle, last_seen) | `address` PK |
| `processed_logs` | Ingestion dedupe ledger | `(contract, txHash, logIndex)` PK |
| `indexer_cursor` | Per-chain checkpoint | `chain_id` PK |
| `indexer_meta` | Seed metadata (history preserving) | `chain_id` PK |
| `meta` | Generic KV store (jsonl offsets, rewards sync markers, etc.) | `key` PK |

**Indices of note**
- `idx_trades_market_ts`, `idx_trades_trader_ts`
- `idx_reward_epochs_block_time`, `idx_reward_claims_wallet_time`, `idx_reward_claims_epoch`
- `idx_market_state_market_ts`, `idx_sponsored_locks_market_ts`
- `ux_processed_contract_txlog`, `ux_trades_txlog`

**Meta keys**
- `lastBlock`, `lastUpdatedAt` – main cursor mirror.
- `rewards_last_block`, `rewards_last_synced_at` – distributor sync progress.
- `jsonl_offset` – position of JSONL ingestion bootstrap.

---

## 4. Indexer Pipelines

### Log ingestion

1. **Batch scheduler** (`runBatch`):
   - Fetch logs for {PredictionMarket, Vault, RewardDistributor[, extra distributors]}. De-dupe per tx/log.
   - Append to JSONL store (`apps/indexer/src/logStore.ts`) + ingest sequentially.
   - For USDC transfers, pull additional logs filtered by distributor address to recover claim TXs when events are missing.
2. **Event handlers** (`handlers.ts`, `handlers/rewards.ts`):
   - `MarketCreated`: insert market, enqueue profile.
   - `MarketTraded`: insert trade, mark market for TVL refresh.
   - `LockUpdated`/`Unlocked`/`SponsoredLocked`/`StakeUpdated`: record vault activity & boost payloads.
   - `MarketResolved` / `TokensRedeemed`: resolution + redemption rows.
   - `EpochRootSet`: `reward_epochs` upsert + event log.
   - `RewardClaimed` OR USDC transfer + `claimReward`/`batchClaimRewards` call: upsert `reward_claims`, emit reward event, update sync meta.
3. **TVL snapshot**: For markets touched in the batch, call `PredictionMarket.getMarketInfo` and persist `market_state` rows (with debounce).
4. **Profiles**: Batched context profile fetcher (configurable concurrency + TTL).

### HTTP server

- `GET /health` → `{ status, lastBlock, lastUpdatedAt }` (pulls from meta/cursor).
- `GET /rewards/:address` → `{ address, epochs: [...], totals, lastRootEpoch, syncedAt }` using `reward_epochs` + `reward_claims` and formatting amounts as decimal strings.

### Environment (Indexer)

| Variable | Description |
| --- | --- |
| `RPC_URLS` / `BASE_RPC` | One or many Base RPC endpoints (round-robin) |
| `PREDICTION_MARKET`, `VAULT`, `REWARD_DISTRIBUTOR`, `USDC` | Contract addresses (lowercased internally) |
| `REWARD_DISTRIBUTORS` | Additional distributor addresses (comma list) |
| `REWARD_TOKEN` | Token used for rewards (USDC) |
| `DATABASE_PATH` | Absolute/relative path to SQLite file |
| `LOOKBACK_DAYS` | Seed window (default 14) |
| `PROFILE_SCRAPE`, `PROFILE_TTL_SECONDS`, `PROFILE_CONCURRENCY` | Profile enrichment controls |
| `RPC_MAX_ATTEMPTS`, `RPC_RETRY_DELAY_MS`, `RPC_TIMEOUT_MS`, `RPC_QPS` | Retry + throttling |
| `LOG_MIN_SPAN`, `LOG_MAX_SPAN`, `LOG_INIT_SPAN` | Adaptive log window bounds |
| `RESNAPSHOT_INTERVAL_MS` | Nightly resnapshot cadence |
| `HTTP_PORT`, `HTTP_HOST` | Indexer HTTP listener (default `4010`, `0.0.0.0`) |

---

## 5. Web Application

### Design system

- Tailwind with `prefix: "bk-"`; font + color tokens defined in `styles/tokens.css` (dark palette only).
- Layout: Sticky top nav, `max-w-7xl` centered shell, responsive 12-col grid (main area 8 cols, right rail 4 cols) with vertical rhythm `bk-space-y-6`.
- Components use rounded panels (`bk-rounded-2xl`, `bk-ring-1 bk-ring-brand-ring/60`, `bk-bg-brand-panel`).

### Top navigation

- Tabs: Traders / Markets / Activity / Creators (query param `tab`).
- Quick Filters (chips) + density toggle (`density=compact`).
- Search box with live dropdown fed by `/api/search` (markets + wallets). Saved view reader via `/api/saved-views`.

### Panels (current state)

1. **KPI Grid** – Bankroll, 24h PnL, 24h rewards, open risk, indexer freshness (mins behind). Currency vs numeric formatting.
2. **Live Slate** – Market cards with:
   - Outcome tags, oracle/surplus/question IDs.
   - Price + TVL sparklines (latest + historical series).
   - Boost/volume/trader chips, cost-to-move pill (Δ1pt).
   - Edge breakdown (boost/volume/traders multiplier) + countdown.
3. **Action Bar** – Top 3 slate entries (title, TVL, edge).
4. **Leaderboard** – Range & bucket toggles; chips for markets touched, last claim, last seen. Sticky column table.
5. **P&L Table** – Rewards + net flow + PnL with teaser chips for positive/negative flows.
6. **My Rewards** – Split bar (creator/booster/trader) + recent activity feed (claims/boosts/trades) and Claim totals.
7. **Near Resolution** – Markets resolving in next 24/48/72h with countdown, TVL, boost, Δ1pt cost.
8. **Competitor Watch** – For top wallets: reward14d, efficiency, avg trade size, claim rate, overlap count, last move, markets 7d, net boost, clarity metrics.
9. **Recently Resolved** – Winner outcome, payout %, surplus, total redeemed, wallet count.
10. **Event Log** – Reward claims, boost events, large trades; error log remains placeholder.

### APIs (server routes)

| Route | Description |
| --- | --- |
| `GET /api/leaderboard` | Query leaderboard (range/by). |
| `GET /api/pnl` | PnL table data. |
| `GET /api/live-slate` | Enriched slate items. |
| `GET /api/near-resolution` | Upcoming resolutions with liquidity stats. |
| `GET /api/me/summary` | Reward splits for configured wallet. |
| `GET /api/competitor-watch` | Competitor analytics. |
| `GET /api/event-log` | (Internally used) event feed. |
| `GET /api/search?q=` | Market + wallet search (uses SQLite FTS-like queries). |
| `GET /api/saved-views` | Read saved view definitions (from `meta` KV). |
| `GET /api/traders` | Summary leaderboard supporting sorts on PnL / volume / rewards. |
| `GET /api/live-slate` | (New payload) includes edge breakdown, series, metadata. |
| `GET /api/near-resolution` | Mirrors updated slate fields. |

### Environment (web)

| Variable | Description |
| --- | --- |
| `BK_DB` | Path to SQLite DB (relative or absolute). |
| `BK_ME` | Wallet address for personalized modules. |
| `NEXT_PUBLIC_CHAIN_ID` | Chain ID for client side (8453). |
| `NEXT_PUBLIC_REWARD_DISTRIBUTOR` | Distributor address (for claim flow). |
| `USDC_TOKEN_ADDRESS` | USDC token on Base. |
| `REWARDS_PROVIDER`, `REWARDS_PROVIDER_BASE_URL` | External proof provider (e.g., Merkl). |
| `INDEXER_URL` | Base URL for indexer HTTP service (`/rewards`). |

---

## 6. Completed vs Outstanding Work

| Area | Status | Notes |
| --- | --- | --- |
| Core ingestion (markets/trades/locks/stakes) | ✅ | Live since initial build. |
| Reward epochs & claims ingestion | ✅ | Distributor events + USDC transfer inference, sync meta stored. |
| Indexer HTTP server | ✅ | `/health`, `/rewards/:address` available on configurable port. |
| Slate UX overhaul | ✅ | Metadata, sparklines, cost-to-move, edge breakdown implemented. |
| Leaderboard / Competitor analytics | ✅ | Markets touched, last claim/seen, net boosts, overlap, clarity metrics. |
| Near-res / Resolved rails | ✅ | Countdown + liquidity, payout post-mortems. |
| Global search | ✅ | Dropdown search live across traders/markets/activity. |
| Reward activity list (My Rewards) | ✅ | Displays creator/booster/trader actions + claims. |
| Indexer freshness KPI | ✅ | Computed via `rewards_last_synced_at`. |
| Reward claim UX (web) | ✅ | Wagmi-driven Claim/Claim all live with Merkl proofs + provider proxy. |
| Action queue / liquidity holes | ✅ | Action queue + liquidity-gap module live (mentions-based insights still optional). |
| Social/mention ingestion (`market_mentions`) | ✅ | Indexer ingests `MENTION_FEED_URL` data into `market_mentions` ready for dashboards. |
| Market quality heuristics persistence | ✅ | Nightly snapshot job writes `market_heuristics` from metadata heuristics. |
| Saved views write API | ✅ | API exists; UI entry point removed in current iteration. |
| Risk chips (rule clarity/source parity) in UI | ✅ | Displayed on slate cards with clarity/source/settlement badges. |
| Wallet exposure explorer & boost ledger UI | ✅ | Exposure table + boost ledger live with API endpoints. |

### Recent Updates (May 2024)

- **Range normalization:** `/api/traders` mirrors the 24h / 7d / 30d range helper. The 14-day default now only exists for initial backfill, not as an interactive filter.
- **Reward totals parity:** `/api/rewards/[address]` returns decimal-dollar strings and `RewardClaimStatus` parses them as-is, eliminating 1e6 scaling bugs.
- **Identity wiring:** Every wallet reference in Overview, Leaderboard (including preview), Markets table, Activity feed/log, Position card, Reward activity and Action queue resolves through `resolveIdentity` and links to `context.markets/wallets/:addr`.
- **Market linking:** Market tiles, watchlists, near-resolution rows, reward activity, and event feeds consistently render the human-readable market title and deep-link to `context.markets/markets/:id`.
- **Event feed enrichment:** `getEventLog` now joins profile + market metadata so the UI can show who acted, what market was touched, and the dollar amount in context.
- **Position header polish:** The “Your Positions” card shows the resolved wallet name with a shortened address subtitle and outbound link.
- **Doc alignment:** Specification updated to reflect the active range options and latest UI behavior.

### Known Gaps / Follow-ups

- **Testing:** Re-run `pnpm --filter context-edge-web test` (Vitest) after the latest refactors; suite last executed before UI identity pass.
- **Range `all` option:** Helpers currently expose 24h/7d/30d. `all` and longer lookback windows remain backlog items.
- **EventLog component:** Should adopt virtual scrolling once feed exceeds ~200 entries (current implementation renders full list).
- **Action queue copy:** Rationale strings still rely on EV/boost heuristics; editorial pass desired.
- **Saved views UI:** API remains but front-end entry point is parked.

---

## 7. Design Backlog & UX Notes

- **Action Queue module:** ranked Create/Boost/Bet/Claim tasks using EV, confidence, hours-to-cutoff, liquidity gap.
- **Liquidity Holes view:** join spread/depth with mentions velocity + creator reputation, highlight boost ROI calculator.
- **Rewards panel:** full claim flow with Merkl proofs, “Claim All”, batch awareness.
- **Risk indicators:** rule clarity meters, source parity badges, settlement risk alerts across slate + resolved cards.
- **Keyboard shortcuts:** (J/K navigation, O open, B boost, T bet) planned but not wired.
- **Analytics extras:** tweet counts/unique authors, odds movement heatmap, competitor overlap matrices, exposure charts.

---

## 8. Runbooks

1. **Bootstrap:** `pnpm install && pnpm copy-abis` (after `forge build` in `contracts/`).
2. **Indexer:** `pnpm --filter context-edge-indexer dev` (requires env). Server listens on `HTTP_PORT` (default 4010).
3. **Dashboard:** `pnpm --filter apps/web dev` with `.env.local` pointing to SQLite path.
4. **Backfill reset:** only if intentional – delete from `indexer_cursor`, `indexer_meta`, `meta` keys (`lastBlock`, `rewards_last_block`), then restart.

---

## 9. Testing & Verification

- `pnpm --filter context-edge-indexer exec tsc --noEmit` / `pnpm --filter context-edge-web exec tsc --noEmit` (TypeScript checks).
- `pnpm --filter context-edge-web exec next lint` (requires initial ESLint config acknowledgement).
- Manual verification: load `/api/live-slate`, `/api/near-resolution`, `/api/search?q=…`, `/api/saved-views`, indexer `/rewards/:address`.

---

## 10. Security & Guardrails

- RPC keys and distributor/private addresses remain secret; guard `.env` files.
- No scraping beyond Context profile lookups; disable via `PROFILE_SCRAPE=false` if required.
- Reward proofs must come from trusted provider (Merkl) – never fabricate.
- CLI instructions for Codex agents: obey master spec, no destructive operations without explicit request, reference this document when updating downstream specs.

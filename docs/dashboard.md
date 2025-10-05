# Context Edge Dashboard Spec

Welcome to the trimmed Context Edge experience. This document tracks the production rules behind the new boost / TVL / ROI dashboard.

## 1. Data Source

- **Database**: `better-sqlite3` connection to `SQLITE_PATH` (defaults to `../../data/context.db`).
- **Tables consumed**: `markets`, `trades`, `locks`, `market_state`, `prices`, `reward_claims`, `rewards`, `profiles`.
- No HTTP dependencies; all numbers are computed synchronously inside the Next.js request/response lifecycle.

## 2. Modules

| Module | Purpose |
| ------ | ------- |
| `lib/database.ts` | Shared singleton + path resolution helpers. |
| `lib/leaderboard.ts` | Aggregates wallet capital, PnL, rewards, ROI weighting and profile hydration. |
| `lib/markets.ts` | Market ranking by outstanding boost, TVL and 24h volume; attaches price sparkline and top holders. |
| `lib/wallet.ts` | Loads BK_ME wallet metrics (capital, boosts, PnL, rewards, ROI rank). |
| `lib/activity.ts` | Recent rewards, boosts, trades (range-constrained). |
| `lib/db.ts` | Barrel exports for route handlers and components. |

## 3. API Routes

| Route | Response |
| ----- | -------- |
| `GET /api/markets?range=24h&limit=12` | `{ chainId, range, rows: MarketSummary[] }` sorted by boost, tvl, volume. |
| `GET /api/leaderboard?range=1w` | `{ chainId, range, rows: LeaderboardRow[] }` sorted by weighted score. |
| `GET /api/activity?range=24h&limit=8` | `{ chainId, range, rows: ActivityEvent[] }`. |

All routes use the same synchronous helpers; no caching layer is required because SQLite reads are fast and the dataset is local.

## 4. Server Page Flow (`app/page.tsx`)

1. Normalize the `range` query (`24h`, `1w`, `1m`).
2. Fetch leaderboard rows; build an in-memory index keyed by address.
3. Request the top market summaries (limit 12) using the leaderboard index to annotate holders with ROI rank.
4. Resolve BK_ME wallet snapshot if configured.
5. Pull recent activity events.
6. Render markets panel, leaderboard, activity list, and user drawer trigger inside a single SSR payload.

## 5. Calculations

- **Capital at risk**: `SUM(usdcIn) - SUM(usdcOut)` per wallet (aggregate of markets with positive outstanding balance).
- **Net profit**: PnL (cash out minus cash in within range) + rewards (claimable/claimed within range).
- **ROI%**: `(netProfit / capitalAtRisk) * 100`. Zero capital yields 0%.
- **Weighted score**: `roiPercent * log10(capitalAtRisk + 1)`; the leaderboard sorts by this score with fallbacks to ROI and capital.
- **Boost locked**: Sponsored minus unlocked amounts across `locks.payloadJson` (micros → USD).
- **Top holders**: Net outstanding per trader per market (based on cumulative trade cashflow sign) classified as YES (>0) or NO (<0) exposure.
- **Edge score**: `(boostLocked * 0.6) + (tvl * 0.3) + (volume24h * 0.1)`.

All currency values stored as micro USDC are parsed via `fromMicros` and rounded to two decimals.

## 6. UI Components

| Component | Notes |
| --------- | ----- |
| `MarketsPanel` | Grid of ranked markets with holder chips, sparkline, edge metrics. |
| `Leaderboard` | Client sorting across ROI/score/capital/profit columns; shows ROI rank and raw address. |
| `ActivityList` | Compact list of latest events with timestamp & amount. |
| `UserDrawer` | Trigger button + slide-out panel; shows CTA when `BK_ME` is missing. |
| `RangeSelector` | Client buttons to update `?range=` using Next navigation. |
| `Sparkline` | Pure SVG mini chart for price history. |

## 7. Environment

Create `apps/web/.env.local` with:

```
SQLITE_PATH=../../data/context.db
BK_ME=0xYourWalletHere
```

While both `SQLITE_PATH` and `BK_DB` are supported, prefer `SQLITE_PATH` for clarity. Omit `BK_ME` to hide the user drawer metrics.

## 8. Validation Checklist

1. **Leaderboard sanity** – run `sqlite3 data/context.db "SELECT lower(trader), SUM(CAST(usdcOut AS INTEGER)-CAST(usdcIn AS INTEGER)) FROM trades GROUP BY trader ORDER BY 2 DESC LIMIT 5;"` and compare to the top rows in the table.
2. **Boost totals** – ensure `boostLocked` in the panel matches `SELECT marketId, SUM(...) FROM locks WHERE type='sponsored' ...` arithmetic for a sampled market.
3. **Holder chips** – confirm the wallet shown as “Biggest YES/NO” has a matching outstanding position by querying the trades table for that market and address.
4. **User drawer** – when `BK_ME` is set, capital and PnL numbers must reconcile with the queries above; when unset, drawer displays configuration guidance.

## 9. Future Enhancements

- Add lightweight Vitest coverage for ROI weighting and top holder extraction.
- Optional caching layer if the database grows large.
- Restore filtered market states (e.g., near resolution, new) once the base experience is locked in.

Stay within this spec when extending the dashboard—any new feature should document its data shape and validation steps here before shipping.

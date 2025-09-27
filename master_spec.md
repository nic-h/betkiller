
# BetKiller — Master Tech Spec v1.1 (history-preserving)

## 0) Goals and invariants

- On first boot, backfill exactly the last 14 days, if its done, check and do not repeat. 
- After backfill, keep ingesting new on-chain events forever. No deletion of old rows. If its existing do not redo use existing we only need this once.
- On-chain truth only from Context contracts on Base:
  - PredictionMarket
  - Vault
  - RewardDistributor (when you add it)
- Always filter getLogs by those contract addresses only. Never “whole Base”.
- Indexer must be idempotent, resumable, reorg-safe, and RPC-thrifty.
- UI defaults to show a 14-day range. Users can select longer ranges, including all time.
- Never write synthetic or placeholder values into the DB. If decoding fails, do not write.
- Environment: your Alchemy key is test. Treat it as a secret at runtime and never commit it.

## 1) High level

- Frontend: Next.js App Router (TypeScript), Tailwind. Reads from /api/* only.
- API: Next.js route handlers using better-sqlite3 read-only.
- Indexer: Node TypeScript with Ethers v6. Filters by the 3 addresses, decodes events, writes SQLite.
- Database: SQLite on a Render persistent disk, WAL mode. Single writer (indexer), many readers (API).
- Jobs: optional nightly snapshots and VACUUM. No pruning.
- Secrets: env vars only. No keys in git.

## 2) Stack

- Node 20, TypeScript strict.
- Indexer: ethers@^6, small concurrency limiter, better-sqlite3.
- Web: Next.js 14 App Router, Tailwind.
- Testing: Vitest, Playwright (optional).
- Lint/format: ESLint + Prettier.

## 3) Config and env



BASE_RPC=https://base-mainnet.g.alchemy.com/v2/
<KEY> # test key at runtime only
BACKFILL_DAYS=14 # seed window, used once
CONFIRMATIONS=8 # reorg safety
STEP=4000 # block chunk size for getLogs
BLOCK_RPC_CONCURRENCY=2 # for block header caching
DATA_DIR=/data # Render disk mount


Optional ops env:



RESET_SEED=0 # set to 1 only if you intentionally re-seed
SNAPSHOT_CRON=disabled # enable if you want daily JSON exports


## 4) Allowed data sources

- Base RPC via BASE_RPC.
- Contract address filter list from Context.
- No external or LLM sources for chain state. No web scraping for core protocol data.

## 5) Event to table mapping (authoritative)

PredictionMarket
- MarketCreated → markets
- MarketTraded → trades
- MarketResolved → resolutions
- TokensRedeemed → redemptions

Vault
- StakeUpdated → stakes
- LockUpdated → locks (kind = lock)
- Unlocked → locks (kind = unlock)
- SponsoredLocked → sponsored_locks

Surplus
- SurplusWithdrawn → surplus_withdrawals

Primary keys
- All event tables: (txHash, logIndex)
- markets: marketId

All large numbers stored as strings in JSON responses.

## 6) Schema (SQLite, history-preserving)

Enable WAL and NORMAL sync. No pruning tables.

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS indexer_cursor(
  chain_id INTEGER PRIMARY KEY,
  last_block INTEGER NOT NULL,
  last_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_meta(
  chain_id INTEGER PRIMARY KEY,
  seed_from_block INTEGER,
  seed_from_ts INTEGER,
  seed_window_days INTEGER,
  seed_completed INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS processed_logs(
  contract TEXT NOT NULL,
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  PRIMARY KEY(contract, txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS markets(
  marketId TEXT PRIMARY KEY,
  oracle TEXT, questionId TEXT, surplusRecipient TEXT, creator TEXT,
  alpha TEXT, marketCreationFee TEXT,
  outcomeTokens TEXT, outcomeNames TEXT, initialQs TEXT,
  createdBlock INTEGER, createdTs INTEGER
);

CREATE TABLE IF NOT EXISTS trades(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, trader TEXT,
  alpha TEXT, usdcFlow TEXT,
  deltaShares TEXT, outcomeQs TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS ix_trades_market_ts ON trades(marketId, ts);

CREATE TABLE IF NOT EXISTS locks(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, locker TEXT,
  amounts TEXT, kind TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS ix_locks_market_ts ON locks(marketId, ts);

CREATE TABLE IF NOT EXISTS sponsored_locks(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, user TEXT,
  setsAmount TEXT, userPaid TEXT, subsidyUsed TEXT, actualCost TEXT,
  outcomes INTEGER, nonce TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS ix_slocks_market_ts ON sponsored_locks(marketId, ts);

CREATE TABLE IF NOT EXISTS stakes(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, staker TEXT,
  amounts TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS resolutions(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, payoutPcts TEXT, surplus TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS ix_resolutions_market_ts ON resolutions(marketId, ts);

CREATE TABLE IF NOT EXISTS redemptions(
  txHash TEXT, logIndex INTEGER,
  marketId TEXT, redeemer TEXT, token TEXT, shares TEXT, payout TEXT,
  blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS ix_redemptions_market_ts ON redemptions(marketId, ts);

CREATE TABLE IF NOT EXISTS surplus_withdrawals(
  txHash TEXT, logIndex INTEGER,
  toAddr TEXT, amount TEXT, blockNumber INTEGER, ts INTEGER,
  PRIMARY KEY(txHash, logIndex)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_trades_txlog
ON trades(txHash, logIndex);

CREATE UNIQUE INDEX IF NOT EXISTS ux_processed_contract_txlog
ON processed_logs(contract, txHash, logIndex);

7) Indexer rules

Seed once, keep forever

If indexer_meta.seed_completed = 0 and cursor is empty:

seed_from_ts = now − BACKFILL_DAYS * 86400

seed_from_block = blockAtUnix(seed_from_ts)

Write indexer_meta with seed info, seed_completed = 1

Set indexer_cursor.last_block = min(seed_from_block, safeHead) − 1

Next boots resume from cursor. No re-seed unless you explicitly reset meta and cursor.

Idempotency and decode

All writes are INSERT OR IGNORE on the keys above.

Keep processed_logs and a per-batch in-memory dedupe set.

If an event cannot be decoded, skip. Log. Do not write partials.

Reorg and RPC safety

Read to safeHead = head − CONFIRMATIONS only.

Chunk STEP blocks per loop.

Cache each block header once per chunk.

Backoff on TIMEOUT, -32016, ECONNRESET, ETIMEDOUT.

Only advance cursor after a successful chunk.

Never prune

Do not delete old rows. Optional: nightly JSON snapshot + VACUUM.

8) API contract

Default range is 14 days when the client does not pass a range. Support longer ranges including all.

Routes (read-only):

GET /api/markets

GET /api/markets/[id]

GET /api/markets/[id]/trades

GET /api/boosts

GET /api/leaderboard

GET /api/near-resolution

GET /api/health

Rules:

Money-like values are strings.

Timestamps are seconds since epoch.

Include chainId: 8453 in payloads.

9) UI data

Default display is last 14 days. Provide selectors for 30d, YTD, All.

Live Slate: Yes price, vig, liquidity proxy (sum of latest outcomeQs), boosted sets, last trade ts.

Leaderboards: creators, traders, boosters, lockers within range.

Resolution and Claims: from resolutions and redemptions.

Prices: prefer on-chain getPrices(marketId) snapshots. No guesswork.

10) Observability

Chunk logs: from, to, count, retries. Cursor advance. Decode warnings with contract, tx, logIndex, topic0.

/api/health: lastBlock, lastTs from cursor, seedCompleted, seed meta.

11) Security

Keep BASE_RPC in env only. Never log it. Rotate the test key if leaked.

12) Guardrails for Codex

Golden rules:

Only the 3 Context addresses for chain data.

Do not fabricate values.

No placeholders in production data paths.

All DB writes use the documented keys.

No deletion unless explicitly asked.

Atomic writes for snapshots (tmp then rename).

Never echo secrets.

Any ingestion or schema change must update this doc in the same PR.

Pre-merge checklist:

getLogs has address filter

No synthetic data

Inserts key on (txHash, logIndex) or marketId

STEP and CONFIRMATIONS from env

Lint, typecheck, decoding tests pass

13) First run and restarts

First run (fresh DB):

sqlite3 $DATA_DIR/context-edge.db ".read apps/indexer/migrations/003_context_protocol.sql"
sqlite3 $DATA_DIR/context-edge.db ".read apps/indexer/migrations/004_indexer_meta.sql"

# ensure clean seed state
sqlite3 $DATA_DIR/context-edge.db "DELETE FROM indexer_cursor; DELETE FROM indexer_meta;"

BASE_RPC=\"https://base-mainnet.g.alchemy.com/v2/<KEY>\" \
BACKFILL_DAYS=14 CONFIRMATIONS=8 STEP=4000 DATA_DIR=$DATA_DIR \
pnpm --filter context-edge-indexer dev


Restart:

BASE_RPC=... CONFIRMATIONS=8 STEP=4000 DATA_DIR=$DATA_DIR \
pnpm --filter context-edge-indexer dev


Sanity:

DB=$DATA_DIR/context-edge.db
sqlite3 "$DB" "SELECT seed_completed, seed_from_block, seed_window_days FROM indexer_meta WHERE chain_id=8453;"
sqlite3 "$DB" "SELECT COUNT(*) FROM processed_logs;"
sqlite3 "$DB" "SELECT datetime(MIN(ts),'unixepoch'), datetime(MAX(ts),'unixepoch') FROM trades;"

14) Storage growth

History is permanent. If file size grows:

Periodic JSON exports to public/snapshots

VACUUM sometimes

Optional monthly partitions later

15) LS-LMSR notes

Prices may sum above 1 due to vig. Show a tip in the UI.

Use getPrices snapshots for display.

Liquidity proxy = sum of outcomeQs.

16) ABI surface needed

MarketCreated, MarketTraded, MarketResolved, TokensRedeemed

StakeUpdated, LockUpdated, Unlocked, SponsoredLocked

SurplusWithdrawn

If an upstream signature changes, ingestion must fail loudly and not write.

17) Testing

Fixture logs for each event type.

Unit tests: decode rows, no dupes on dup logs, skip on decode fail.

API tests: default range 14d, support “all”.

18) No fake data policy

No default zero fills.

No synthetic rows to fill gaps.

If a metric cannot be computed, show “—” in UI.

Any off-chain enrichment is flagged separately and never mixed with on-chain facts.


---

## 2) Add migration `apps/indexer/migrations/004_indexer_meta.sql`

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS indexer_meta(
  chain_id INTEGER PRIMARY KEY,
  seed_from_block INTEGER,
  seed_from_ts INTEGER,
  seed_window_days INTEGER,
  seed_completed INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);


Run it once:

sqlite3 apps/indexer/data/context-edge.db ".read apps/indexer/migrations/004_indexer_meta.sql"

3) Add seed helper apps/indexer/src/seed.ts
// apps/indexer/src/seed.ts
import { JsonRpcProvider, Block } from "ethers";
import { db } from "./db";

type SeedOpts = {
  chainId: number;
  backfillDays: number;
  confirmations: number;
  step: number;
  addresses: `0x${string}`[];
  provider: JsonRpcProvider;
  log?: (...args: any[]) => void;
};

/**
 * Ensure we seed exactly once. If cursor exists, we do nothing.
 * If cursor is empty and meta.seed_completed is 0 or null, compute seed_from_block,
 * store meta with seed_completed=1, and set cursor to min(seed_from_block, safeHead)-1.
 * No pruning. History is kept forever.
 */
export async function ensureSeedOnce(opts: SeedOpts): Promise<void> {
  const {
    chainId, backfillDays, confirmations, provider, log = console.log,
  } = opts;

  const curRow = db.prepare(
    "SELECT last_block AS b FROM indexer_cursor WHERE chain_id=?"
  ).get(chainId) as { b?: number } | undefined;

  if (curRow?.b != null) {
    log(`[seed] cursor exists at ${curRow.b}. Skip seeding.`);
    return;
  }

  const meta = db.prepare(
    "SELECT seed_completed, seed_from_block FROM indexer_meta WHERE chain_id=?"
  ).get(chainId) as { seed_completed?: number; seed_from_block?: number } | undefined;

  const head = Number(await provider.getBlockNumber());
  const safeHead = head - confirmations;

  // helper to find block at a given unix ts
  async function blockAtUnix(targetSec: number): Promise<number> {
    let lo = 0, hi = head;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const b = await provider.getBlock(mid) as Block;
      const ts = Number(b.timestamp);
      if (ts < targetSec) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  let seedFromBlock: number;

  if (!meta || !meta.seed_completed) {
    const seedFromTs = Math.floor(Date.now() / 1000) - backfillDays * 86400;
    seedFromBlock = await blockAtUnix(seedFromTs);
    const now = Math.floor(Date.now() / 1000);

    db.prepare(`
      INSERT INTO indexer_meta(chain_id,seed_from_block,seed_from_ts,seed_window_days,seed_completed,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(chain_id) DO UPDATE SET
        seed_from_block=excluded.seed_from_block,
        seed_from_ts=excluded.seed_from_ts,
        seed_window_days=excluded.seed_window_days,
        seed_completed=1,
        updated_at=excluded.updated_at
    `).run(chainId, seedFromBlock, seedFromTs, backfillDays, now, now);

    const startBlock = Math.max(0, Math.min(seedFromBlock, safeHead) - 1);

    db.prepare(`
      INSERT INTO indexer_cursor(chain_id,last_block,last_ts)
      VALUES(?,?,strftime('%s','now'))
      ON CONFLICT(chain_id) DO UPDATE SET last_block=excluded.last_block,last_ts=excluded.last_ts
    `).run(chainId, startBlock);

    log(`[seed] set cursor to ${startBlock} (seed_from_block=${seedFromBlock}, safeHead=${safeHead})`);
    return;
  }

  // meta exists with seed completed but cursor missing: rebuild cursor from meta
  seedFromBlock = meta.seed_from_block ?? safeHead;
  const startBlock = Math.max(0, Math.min(seedFromBlock, safeHead) - 1);
  db.prepare(`
    INSERT INTO indexer_cursor(chain_id,last_block,last_ts)
    VALUES(?,?,strftime('%s','now'))
    ON CONFLICT(chain_id) DO UPDATE SET last_block=excluded.last_block,last_ts=excluded.last_ts
  `).run(chainId, startBlock);
  log(`[seed] restored cursor from meta at ${startBlock}`);
}

4) Minimal patch to apps/indexer/src/index.ts

Add the import and call before you enter your follow loop.

// top of file
import { JsonRpcProvider } from "ethers";
import { ensureSeedOnce } from "./seed";

// ... your existing config/env reads ...

// after you construct provider, addresses, etc.
const provider = new JsonRpcProvider(process.env.BASE_RPC!);

// call this once at startup
await ensureSeedOnce({
  chainId: 8453,
  backfillDays: Number(process.env.BACKFILL_DAYS || 14),
  confirmations: Number(process.env.CONFIRMATIONS || 8),
  step: Number(process.env.STEP || process.env.CHUNK || 4000),
  addresses: ADDRS as `0x${string}`[],
  provider,
  log: (...a) => console.log(...a)
});

// then continue with your normal cursor = getLastBlock() and follow loop.
// do not run any “backfill 14d” code elsewhere anymore.


If your index.ts is not async at top level, wrap the call in your main bootstrap function before the follow loop.

5) Apply and run
# write the files above, then:

sqlite3 apps/indexer/data/context-edge.db ".read apps/indexer/migrations/004_indexer_meta.sql"

# first boot (fresh)
sqlite3 apps/indexer/data/context-edge.db "DELETE FROM indexer_cursor; DELETE FROM indexer_meta;"

BASE_RPC="https://base-mainnet.g.alchemy.com/v2/4EsZlaI2UJEdv2xXHR77Tf-oZJ2LoDtI" \
BACKFILL_DAYS=14 CONFIRMATIONS=8 STEP=4000 \
pnpm --filter context-edge-indexer dev


Verify seed state and data are growing:

DB=apps/indexer/data/context-edge.db
sqlite3 "$DB" "SELECT * FROM indexer_meta;"
sqlite3 "$DB" "SELECT COUNT(*) FROM processed_logs;"
sqlite3 "$DB" "SELECT datetime(MIN(ts),'unixepoch'), datetime(MAX(ts),'unixepoch') FROM trades;"

Notes

This keeps the first 14 days you seed, then appends forever. No pruning.

It never re-seeds on restart because indexer_meta.seed_completed=1 and indexer_cursor exists.

No fake data anywhere. If a decode fails, skip the write and log it.

“Design language & tokens” addendum you can paste into docs/MASTER_SPEC.md. it sets hard rules for look/feel, data-first surfaces, and gives copy-pasteable tokens (CSS vars + Tailwind), chart rules, accessibility, and number formatting.

19) Design language & tokens (history-preserving, data-first)
19.1 Design goals

Data first. Every screen must surface what changed and why it matters (volume, price deltas, boosts, resolutions).

Context vibe. Clean, modern, dark UI with crisp borders, subtle depth, electric-blue accent; zero skeuomorphism.

Trustworthy. No fake data, no “estimates.” If a metric is unavailable, show — with a tooltip saying why.

Readable fast. Tight grids, strong hierarchy, monospace for numbers, consistent alignment.

Accessible. AA contrast minimum, focus states everywhere, keyboard navigable.

19.2 Design tokens (CSS variables)

Prefix --bk-. Never hardcode hex in components. All colors come from tokens.

/* apps/web/styles/tokens.css */
:root {
  /* palettes */
  --bk-bg:           0 0% 6%;   /* hsl */
  --bk-surface:      0 0% 9%;
  --bk-surface-2:    0 0% 12%;
  --bk-border:       0 0% 18%;
  --bk-muted:        0 0% 62%;
  --bk-text:         0 0% 96%;

  --bk-accent:       206 100% 55%;  /* electric blue */
  --bk-accent-600:   206 100% 48%;
  --bk-accent-700:   206 100% 41%;

  --bk-success:      152 65% 45%;
  --bk-warning:      41 95% 50%;
  --bk-danger:       2 86% 57%;

  /* states */
  --bk-focus:        206 100% 55%;
  --bk-ring:         206 100% 55%;

  /* radii */
  --bk-radius-sm:    8px;
  --bk-radius:       12px;
  --bk-radius-lg:    16px;
  --bk-radius-xl:    20px;

  /* spacing scale (px) */
  --bk-space-0: 0; --bk-space-1: 4px; --bk-space-2: 8px; --bk-space-3: 12px;
  --bk-space-4: 16px; --bk-space-5: 20px; --bk-space-6: 24px; --bk-space-8: 32px; --bk-space-10: 40px; --bk-space-12: 48px;

  /* typography */
  --bk-font-sans: ui-sans-serif, Inter, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Apple Color Emoji","Segoe UI Emoji";
  --bk-font-mono: ui-monospace, "Fira Code", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;

  --bk-text-xs: 11px;
  --bk-text-sm: 12px;
  --bk-text-md: 14px;
  --bk-text-lg: 16px;
  --bk-text-xl: 20px;
  --bk-text-2xl: 24px;
  --bk-text-3xl: 32px;

  /* elevation (use sparingly) */
  --bk-shadow-sm: 0 1px 0 hsl(var(--bk-border)/0.9), 0 1px 8px hsl(0 0% 0% / 0.2);
  --bk-shadow:    0 1px 0 hsl(var(--bk-border)/0.9), 0 6px 24px hsl(0 0% 0% / 0.35);
}

:root[data-theme="light"] {
  --bk-bg:         0 0% 100%;
  --bk-surface:    0 0% 99%;
  --bk-surface-2:  0 0% 97%;
  --bk-border:     0 0% 86%;
  --bk-muted:      0 0% 38%;
  --bk-text:       0 0% 10%;

  --bk-accent:     206 100% 48%;
  --bk-accent-600: 206 100% 41%;
  --bk-accent-700: 206 100% 35%;
}

19.3 Tailwind config (read tokens via HSL)
// apps/web/tailwind.config.ts
import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: 'var(--bk-font-sans)',
        mono: 'var(--bk-font-mono)',
      },
      colors: {
        bg:        "hsl(var(--bk-bg))",
        surface:   "hsl(var(--bk-surface))",
        surface2:  "hsl(var(--bk-surface-2))",
        border:    "hsl(var(--bk-border))",
        muted:     "hsl(var(--bk-muted))",
        text:      "hsl(var(--bk-text))",
        accent:    "hsl(var(--bk-accent))",
        success:   "hsl(var(--bk-success))",
        warning:   "hsl(var(--bk-warning))",
        danger:    "hsl(var(--bk-danger))",
      },
      borderRadius: {
        DEFAULT: "var(--bk-radius)",
        sm: "var(--bk-radius-sm)",
        lg: "var(--bk-radius-lg)",
        xl: "var(--bk-radius-xl)",
      },
      boxShadow: {
        sm: "var(--bk-shadow-sm)",
        DEFAULT: "var(--bk-shadow)",
      }
    },
  },
  plugins: [],
};
export default config;

19.4 Component rules

Cards

Background surface, border border, radius --bk-radius, shadow only for overlays.

Header: label (sm, muted), value (xl/2xl, mono, strong), delta pill (accent/success/danger).

Content must never overflow; wrap long market titles.

Buttons

Primary: accent bg → white text; hover darken (accent-600); focus ring --bk-ring.

Secondary: surface-2 bg + border; text text.

Destructive: danger bg; confirm dialogs required for irreversible actions.

Inputs

Height 40px; border border; focus ring offset 0–1px.

Pills/Tags

Use for market state (Active, Paused, Resolved), deltas (+/-), roles (Creator/Booster/Trader).

Tables

Dense, zebra surface rows with subtle border dividers, 12–14px text, right-align numeric columns.

19.5 Data-first surfaces & “what to show”

Global dashboard (range default 14d)

Top KPIs (mono, big):

Total Volume (∑|usdcFlow| in trades)

Active Markets (with at least 1 trade in range)

Boosted USDC Outstanding (sum sponsored_locks.userPaid + subsidyUsed not yet unlocked)

Reward Claims (count of redemptions in range)

Resolved Markets (count in range)

Top movers: markets with largest absolute Yes price change in last 24h (or selected range slice). Requires snapshot getPrices; if stale → show — and a tooltip “snapshot stale”.

Near resolution: markets with MarketResolved in last 48h or Paused within 24h (if you index pause later).

New & active: recent MarketCreated that have trades; show liquidity proxy (sum of last outcomeQs), boosts, and trades count.

Leaderboards (14d by default)

Creators: markets created by user with trade volume weighting.

Boosters: rank by userPaid, tie-break by setsAmount and count.

Lockers: net locked (LockUpdated − Unlocked).

Traders: sum of |usdcFlow|; show win rate once redemptions exist.

Market detail

Price line (Yes), cumulative volume, boost timeline, recent trades (mono), outcome chips with current prices.

Payout at resolution (from payoutPcts) once resolved; “Claim” CTA if the user has redemptions.

19.6 Charts & viz rules

Library: Recharts. No 3D. No gradients unless subtle and legible.

Colors:

Primary line: accent

Up/delta+: success

Down/delta−: danger

Gridlines: border at 20–30% opacity.

Axes / ticks: 12px; use compact units (1.2k, 3.4M). Time axis uses local tz.

Tooltips: monospace values, absolute + delta where applicable.

Sparkline in tables: 48–72px width, no axes, stroke accent.

19.7 Motion

Framer Motion only; durations 120–200ms. Easing easeOut.

Slide/scale for overlays at <= 8px translate; no bounce.

Reduce motion if user prefers-reduced-motion.

19.8 Accessibility

Minimum contrast AA: text vs background ≥ 4.5:1. Verify accent on surface passes for body text; otherwise use accent only for UI chrome, not long paragraphs.

Focus visible everywhere (outline-offset: 2px; color: --bk-focus).

All interactive elements keyboard reachable; tables have row focus.

Semantics: aria-live="polite" for dynamic KPIs; aria-describedby on charts to link to numeric summary.

19.9 Number & time formatting (hard rules)

Currency: USDC, show $, group thousands, 2–4 decimals dynamically:

≥ $10 → 2dp; $1–10 → 3dp; < $1 → up to 4dp (trim trailing zeros).

Percent: 2dp; price = Yes% shows 0–100 with 1dp.

Delta labels: prepend +/− and color success/danger.

Compact: 1.2k / 3.4M for volume counts.

Timestamps: local tz (Australia/Melbourne), DD MMM, HH:mm. Tooltips show full ISO.

19.10 Empty/loading/error states

Loading: skeletons (no spinners) with width approximating final layout.

Empty: “No trades in the last 14 days” with suggestion chips (switch range, open markets list).

Error: inline banner with copy “Data unavailable: RPC rate-limited” and a quiet retry.

19.11 Component examples (usage, not exhaustive)

KPI Card

// components/KpiCard.tsx
export function KpiCard({ label, value, delta }: { label:string; value:string; delta?:{v:string; pos:boolean} }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="text-muted text-[var(--bk-text-sm)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-[var(--bk-text-2xl)] text-text">{value}</span>
        {delta && (
          <span className={`font-mono text-[var(--bk-text-sm)] ${delta.pos ? "text-success" : "text-danger"}`}>
            {delta.pos ? "▲" : "▼"} {delta.v}
          </span>
        )}
      </div>
    </div>
  );
}


Delta pill

export function Delta({ v, pos }:{v:string; pos:boolean}) {
  return (
    <span className={`rounded-sm px-2 py-0.5 font-mono text-xs ${pos ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
      {pos ? "+" : "−"}{v}
    </span>
  );
}

19.12 Layout patterns

Grid: 12-col desktop; gutters --bk-space-5. Cards min-height 120–160px.

Responsive: 3 cols ≥ 1280px, 2 cols between 768–1279px, 1 col under 768px.

Header: sticky top (surface), 56px height, actions right-aligned.

Detail page: two-pane—left main chart + stats, right rail with trades/boosts.

19.13 Copy & tone

Tone: confident, neutral, concise. Avoid jargon unless needed; define it inline via tooltips.

Never imply certainty in probabilities; always “implied”, “current odds”.

Empty states suggest actions. Errors name the failing system (e.g., “RPC rate-limited”).

19.14 QA checklist (visual & data)

 All colors pulled from tokens; no raw hex.

 Mono font for numeric content; alignment right for numbers in tables.

 Default range is 14d; “All time” switch present.

 Any missing snapshot shows — with tooltip reason; no placeholders.

 Charts pass color-blind checks (danger/success distinguishable vs accent).

 Focus outlines visible on all interactive elements.

 Prices and currency formatting follow 19.9.

19.15 Do / Don’t

Do

Use small, dense cards for KPIs with clear deltas.

Show change over time (sparklines) where space permits.

Annotate resolutions and large boosts on charts.

Don’t

Don’t compute or display synthetic “estimates”.

Don’t show “NaN”/“undefined”; show — with a cause.

Don’t animate layout shifts on data refresh (content jump).

Implementation notes

Import tokens.css globally in your Next app/layout.tsx.

Tailwind config above reads tokens; avoid theme drift by banning un-tokenized text-[#...] via ESLint style rule if you want.
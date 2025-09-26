```yaml
app:
  name: Betkiller Dash
  components:
    - name: indexer
      runtime: node
      entry: apps/indexer/src/index.ts
      description: "Consumes Context Markets events from Base, writes to SQLite, enriches profiles, captures market TVL snapshots."
    - name: web
      runtime: nextjs
      entry: apps/web/app/page.tsx
      description: "Prefixed Tailwind UI that reads SQLite analytics and exposes API routes for the dashboard."
  data_sources:
    - contract: PredictionMarket
      events: [MarketCreated, MarketTraded, MarketResolved]
    - contract: Vault
      events: [LockUpdated, StakeUpdated, Unlocked, SponsoredLocked]
    - contract: RewardDistributor
      events: [RewardClaimed, EpochRootSet]
  sqlite_tables:
    markets: {primary_key: marketId, fields: [creator, oracle, surplusRecipient, questionId, outcomeNames, metadata, createdAt]}
    trades: {fields: [ts, marketId, txHash, trader, usdcIn, usdcOut]}
    locks: {fields: [ts, marketId, user, type, payloadJson]}
    rewards: {fields: [ts, kind, epochId, user, amount, root]}
    market_state: {fields: [marketId, ts, totalUsdc, totalQ, alpha]}
    profiles: {fields: [address, display_name, x_handle, last_seen]}
    impact: {fields: [marketId, usdcClip, deltaProb, ts]}
  apis:
    - path: /api/leaderboard
      params: {range: [24h,7d,14d], by: [total,creator,booster,trader,eff]}
      returns: LeaderboardRow[]
    - path: /api/pnl
      params: {range: [24h,7d,14d]}
      returns: PnlRow[]
    - path: /api/live-slate
      returns: SlateItem[]
    - path: /api/near-resolution
      returns: NearResolutionItem[]
    - path: /api/me/summary
      params: {range: [24h,7d,14d]}
      returns: RewardSplit[]
    - path: /api/competitor-watch
      returns: CompetitorEntry[]
  env:
    indexer:
      required: [BASE_RPC, LOOKBACK_DAYS, CONTEXT_BASE, PROFILE_SCRAPE]
      optional: [PROFILE_TTL_SECONDS, PROFILE_CONCURRENCY, RPC_MAX_ATTEMPTS, RPC_RETRY_DELAY_MS]
    web:
      required: [BK_DB]
      optional: [BK_ME, NEXT_PUBLIC_BASE_URL]
  ui_panels:
    - KPIs (bankroll, pnl_24h, rewards_24h, open_risk)
    - LiveSlate (TVL, boost_total, volume_24h, traders, edge)
    - Leaderboard (range+bucket toggles)
    - PnLTable (reward, net_flow, pnl)
    - MyRewards split bar (creator/booster/trader)
    - NearResolution list
    - CompetitorWatch summary
    - EventLog & error feed
  telemetry:
    lookback_days: env.LOOKBACK_DAYS
    retry_policy: {max_attempts: env.RPC_MAX_ATTEMPTS, base_delay_ms: env.RPC_RETRY_DELAY_MS}
limitations:
  - History limited to LOOKBACK_DAYS (default 14)
  - PnL only uses realised on-chain cashflows
  - Profile info depends on context.markets availability
  - Requires forge build + pnpm copy-abis after contract changes
```

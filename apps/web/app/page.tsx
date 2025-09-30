import { Metadata } from "next";

import {
  getActionQueue,
  getCompetitorWatch,
  getErrorLog,
  getEventLog,
  getKpis,
  getLeaderboard,
  getLiveSlate,
  getMarketsTable,
  getMeAddress,
  getMySummary,
  getNearResolution,
  getPnl,
  getResolvedMarkets,
  getWalletExposure,
  getBoostLedger
} from "@/lib/db";
import type { LeaderboardBucket } from "@/lib/db";
import { ensureRange, formatRangeLabel } from "@/lib/range";
import { KPIGrid } from "@/components/KPI";
import { LiveSlate, type SlateFilter } from "@/components/Slate";
import { ActionQueue } from "@/components/ActionQueue";
import { Leaderboard } from "@/components/Leaderboard";
import { PnLTable } from "@/components/PnLTable";
import { MyRewardsCard } from "@/components/MyRewardsCard";
import { NearResolutionList } from "@/components/NearResolution";
import { CompetitorWatch } from "@/components/CompetitorWatch";
import { ResolvedRail } from "@/components/ResolvedRail";
import { EventLog } from "@/components/EventLog";
import { WalletExposureExplorer } from "@/components/WalletExposureExplorer";
import { ActivityFeed } from "@/components/ActivityFeed";
import { MarketsTable } from "@/components/MarketsTable";
import { MetricsPopover } from "@/components/MetricsPopover";

export const metadata: Metadata = {
  title: "context.dash",
  description: "Live edge finder across Context Markets"
};

type TabKey = "traders" | "markets" | "activity" | "creators";
type FilterKey = SlateFilter;

export default async function Page({
  searchParams
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const rangeParam = getFirst(searchParams.range);
  const tabParam = getFirst(searchParams.tab);
  const filterParam = getFirst(searchParams.filter);
  const bucketParam = getFirst(searchParams.by);

  const range = ensureRange(rangeParam);
  const tab = normalizeTab(tabParam);
  const filter = normalizeFilter(filterParam);
  const bucket = normalizeBucket(bucketParam);

  if (tab === "markets") {
    const markets = getMarketsTable(range, 600);
    return (
      <main className="bk-space-y-6">
        <MarketsTable rows={markets} />
      </main>
    );
  }

  if (tab === "activity") {
    const events = getEventLog(range, 160);
    return (
      <main className="bk-space-y-6">
        <ActivityFeed initial={events} range={range} />
      </main>
    );
  }

  if (tab === "creators") {
    const [leaderboardRows, competitors, splits] = await Promise.all([
      Promise.resolve(getLeaderboard(range, "creator")),
      Promise.resolve(getCompetitorWatch()),
      Promise.resolve(getMySummary(range))
    ]);

    const me = getMeAddress();
    const rangeLabel = formatRangeLabel(range);

    return (
      <main className="bk-space-y-6">
        <Leaderboard initialRows={leaderboardRows} initialBucket="creator" />
        <div className="bk-grid bk-grid-cols-1 xl:bk-grid-cols-3 bk-gap-4">
          <MyRewardsCard address={me} splits={splits} rangeLabel={rangeLabel} />
          <div className="xl:bk-col-span-2">
            <CompetitorWatch entries={competitors} />
          </div>
        </div>
      </main>
    );
  }

  const [
    kpis,
    slate,
    queue,
    leaderboardRows,
    pnlRows,
    rewardSplits,
    nearResolution,
    competitors,
    resolved,
    events,
    errors,
    exposures
  ] = await Promise.all([
    Promise.resolve(getKpis(range)),
    Promise.resolve(getLiveSlate(range, 40)),
    getActionQueue(range),
    Promise.resolve(getLeaderboard(range, bucket)),
    Promise.resolve(getPnl(range, 40)),
    Promise.resolve(getMySummary(range)),
    Promise.resolve(getNearResolution(range)),
    Promise.resolve(getCompetitorWatch()),
    Promise.resolve(getResolvedMarkets(8)),
    Promise.resolve(getEventLog(range, 60)),
    Promise.resolve(getErrorLog()),
    Promise.resolve(getWalletExposure(60))
  ]);

  const me = getMeAddress();
  const initialLedgerAddress = me ?? exposures[0]?.addr ?? null;
  const boostLedger = initialLedgerAddress ? getBoostLedger(initialLedgerAddress, 40) : [];
  const rangeLabel = formatRangeLabel(range);

  return (
    <main className="bk-space-y-6">
      <section className="bk-space-y-4">
        <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-3">
          <h1 className="bk-text-lg bk-font-medium bk-text-brand-text">Edge overview</h1>
          <MetricsPopover />
        </div>
        <KPIGrid items={kpis} />
      </section>

      <section className="bk-grid bk-grid-cols-1 xl:bk-grid-cols-12 bk-gap-4">
        <div className="xl:bk-col-span-8 bk-space-y-4">
          <LiveSlate initial={slate} filter={filter} />
          <ActionQueue initial={queue} range={range} />
          <Leaderboard initialRows={leaderboardRows} initialBucket={bucket} />
          <PnLTable initialRows={pnlRows} initialRange={range} />
        </div>
        <div className="xl:bk-col-span-4 bk-space-y-4">
          <MyRewardsCard address={me} splits={rewardSplits} rangeLabel={rangeLabel} />
          <NearResolutionList initial={nearResolution} range={range} />
          <CompetitorWatch entries={competitors} />
        </div>
      </section>

      <WalletExposureExplorer
        initialExposure={exposures}
        initialLedger={boostLedger}
        initialAddress={initialLedgerAddress}
      />

      <ResolvedRail items={resolved} />
      <EventLog events={events} errors={errors} />
    </main>
  );
}

function normalizeTab(value: string | undefined): TabKey {
  switch ((value ?? "traders").toLowerCase()) {
    case "markets":
      return "markets";
    case "activity":
      return "activity";
    case "creators":
      return "creators";
    case "overview":
    case "traders":
    default:
      return "traders";
  }
}

function normalizeFilter(value: string | undefined): FilterKey {
  switch ((value ?? "top").toLowerCase()) {
    case "boosted":
      return "boosted";
    case "resolution":
    case "near":
      return "resolution";
    case "new":
      return "new";
    default:
      return "top";
  }
}

function normalizeBucket(value: string | undefined): LeaderboardBucket {
  switch ((value ?? "total").toLowerCase()) {
    case "creator":
      return "creator";
    case "booster":
      return "booster";
    case "trader":
      return "trader";
    case "eff":
    case "efficiency":
      return "efficiency";
    default:
      return "total";
  }
}

function getFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

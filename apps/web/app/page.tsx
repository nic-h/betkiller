import { KPIGrid } from "@/components/KPI";
import { Leaderboard } from "@/components/Leaderboard";
import { LiveSlate } from "@/components/Slate";
import { NearResolutionList } from "@/components/NearResolution";
import { SplitBar } from "@/components/SplitBar";
import { CompetitorWatch } from "@/components/CompetitorWatch";
import { EventLog } from "@/components/EventLog";
import { PnLTable } from "@/components/PnLTable";
import { ResolvedRail } from "@/components/ResolvedRail";
import { RewardActivity } from "@/components/RewardActivity";
import { RewardClaimStatus } from "@/components/RewardClaimStatus";
import { ActionQueue } from "@/components/ActionQueue";
import { LiquidityHoles } from "@/components/LiquidityHoles";
import { WalletExposureExplorer } from "@/components/WalletExposureExplorer";
import {
  getCompetitorWatch,
  getEventLog,
  getErrorLog,
  getKpis,
  getLeaderboard,
  getLiveSlate,
  getMeAddress,
  getMySummary,
  getNearResolution,
  getPnl,
  getResolvedMarkets,
  getSavedViews,
  findSavedViewByQuery,
  getActionQueue,
  getLiquidityHoles,
  getWalletExposure,
  getBoostLedger
} from "@/lib/db";
import { formatMoney, formatHoursUntil } from "@/lib/fmt";
import type { SlateItem } from "@/lib/db";

export default async function Page({
  searchParams
}: {
  searchParams: { range?: string; by?: string; density?: string; tab?: string };
}) {
  const initialRange = (searchParams.range as any) ?? "14d";
  const initialBucket = (searchParams.by as any) ?? "total";
  const dense = searchParams.density === "compact";
  const tab = (searchParams.tab ?? "traders").toLowerCase();
  const showMarkets = tab === "markets";
  const showTraders = tab === "traders";
  const showCreators = tab === "creators";
  const showActivity = tab === "activity";

  const [
    kpis,
    leaderboard,
    liveSlate,
    nearResolution,
    mySummary,
    pnlRows,
    competitors,
    events,
    errors,
    resolved,
    savedViews,
    actionQueue,
    liquidityHoles,
    walletExposure
  ] = await Promise.all([
    getKpis(),
    Promise.resolve(getLeaderboard(initialRange as any, initialBucket as any)),
    Promise.resolve(getLiveSlate()),
    Promise.resolve(getNearResolution()),
    Promise.resolve(getMySummary("14d")),
    Promise.resolve(getPnl("14d")),
    Promise.resolve(getCompetitorWatch()),
    Promise.resolve(getEventLog()),
    Promise.resolve(getErrorLog()),
    Promise.resolve(getResolvedMarkets(8)),
    Promise.resolve(getSavedViews()),
    Promise.resolve(getActionQueue()),
    Promise.resolve(getLiquidityHoles()),
    Promise.resolve(getWalletExposure())
  ]);

  const me = getMeAddress();
  const myRank = me ? leaderboard.findIndex((row) => row.addr === me) + 1 || null : null;
  const spotlightMarkets = liveSlate.slice(0, 3);
  const mySummaryLabel = mySummary.length > 1 ? "Past 14 days by bucket" : "Past 14 days";

  const searchEntries = Object.entries(searchParams ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const searchString = new URLSearchParams(searchEntries).toString();
  const activeSavedView = findSavedViewByQuery(searchString, savedViews);
  const defaultExposureAddr = me && walletExposure.some((row) => row.addr === me)
    ? me
    : walletExposure[0]?.addr ?? null;
  const boostLedger = showCreators && defaultExposureAddr ? getBoostLedger(defaultExposureAddr, 40) : [];

  return (
    <main className="bk-space-y-8">
      {activeSavedView && (
        <div className="bk-flex bk-items-center bk-gap-2">
          <span className="bk-text-2xs bk-text-brand-muted">View</span>
          <span className="bk-rounded-full bk-bg-brand-blue/20 bk-text-brand-blue bk-px-3 bk-py-1 bk-text-2xs">
            {activeSavedView.label}
          </span>
        </div>
      )}

      {me && (
        <div className="bk-flex bk-items-center bk-gap-3 bk-rounded-full bk-bg-brand-surface bk-border bk-border-brand-ring/40 bk-px-4 bk-py-2 bk-text-sm">
          <span className="bk-text-brand-muted">Wallet</span>
          <span className="bk-text-brand-blue">{me}</span>
          {myRank && myRank > 0 && <span className="bk-text-brand-muted">Rank #{myRank}</span>}
        </div>
      )}

      <KPIGrid items={kpis} />

      {showMarkets && (
        <div className="bk-space-y-6">
          <ActionQueue initial={actionQueue} />
          <LiveSlate initial={liveSlate} />
          <ActionSpotlight items={spotlightMarkets} />
          <LiquidityHoles initial={liquidityHoles} />
          <NearResolutionList initial={nearResolution} />
        </div>
      )}

      {showTraders && (
        <div className="bk-space-y-6">
          <Leaderboard
            dense={dense}
            initialRows={leaderboard}
            initialRange={initialRange as any}
            initialBucket={initialBucket as any}
          />
          <PnLTable dense={dense} initialRows={pnlRows} initialRange="14d" />
          <CompetitorWatch entries={competitors} />
        </div>
      )}

      {showCreators && (
        <div className="bk-space-y-6">
          <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
            <header className="bk-flex bk-items-center bk-justify-between">
              <div>
                <h2 className="bk-text-sm bk-text-brand-muted">My rewards</h2>
                <p className="bk-text-xs bk-text-brand-muted">{mySummaryLabel}</p>
              </div>
            </header>
            <SplitBar data={mySummary} />
            <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-xs bk-text-brand-muted">
              {mySummary.map((item) => (
                <div key={item.bucket} className="bk-flex bk-justify-between bk-tabular-nums">
                  <span>{item.bucket}</span>
                  <span>{formatMoney(item.reward)}</span>
                </div>
              ))}
            </div>
            <RewardClaimStatus address={me} />
            <RewardActivity splits={mySummary} />
          </section>
          <WalletExposureExplorer
            initialExposure={walletExposure}
            initialLedger={boostLedger}
            initialAddress={defaultExposureAddr}
          />
        </div>
      )}

      {showActivity && (
        <div className="bk-space-y-6">
          <ResolvedRail items={resolved} />
          <EventLog events={events} errors={errors} />
        </div>
      )}
    </main>
  );
}

function ActionSpotlight({ items }: { items: SlateItem[] }) {
  const spotlight = items.slice(0, 3);
  if (!spotlight.length) return null;

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">Focus queue</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Markets with the highest immediate edge.</p>
        </div>
      </header>
      <div className="bk-grid md:bk-grid-cols-3 bk-gap-3">
        {spotlight.map((item, index) => {
          const highlight = index === 0;
          const cardTone = highlight ? "bk-border-warning/50 bk-bg-warning/10" : "bk-border-brand-ring/40 bk-bg-brand-surface";
          return (
            <div
              key={item.marketId}
              className={`bk-rounded-2xl bk-border ${cardTone} bk-p-4 bk-space-y-2`}
            >
              <div className="bk-flex bk-items-start bk-justify-between bk-gap-2">
                <a
                  href={`https://context.markets/markets/${item.marketId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`bk-text-sm ${highlight ? "bk-text-brand-orange" : "bk-text-brand-text"} hover:bk-text-brand-blue`}
                >
                  {item.title}
                </a>
                <span className="bk-rounded-full bk-bg-brand-blue/15 bk-text-brand-blue bk-text-2xs bk-font-medium bk-px-2 bk-py-0.5">
                  Edge {item.edgeScore.toFixed(1)}
                </span>
              </div>
              <div className="bk-flex bk-flex-wrap bk-gap-3 bk-text-2xs bk-text-brand-muted">
                <span>Cutoff {formatHoursUntil(item.cutoffTs)}</span>
                <span>TVL {formatMoney(item.tvl)}</span>
                <span>Boost {formatMoney(item.boostTotal)}</span>
                <span>24h Vol {formatMoney(item.volume24h)}</span>
                {item.costToMove && item.costToMove.costPerPoint != null && (
                  <span>Δ1pt {formatMoney(item.costToMove.costPerPoint)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

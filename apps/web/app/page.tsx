import { KPIGrid } from "@/components/KPI";
import { Leaderboard } from "@/components/Leaderboard";
import { LiveSlate } from "@/components/Slate";
import { NearResolutionList } from "@/components/NearResolution";
import { SplitBar } from "@/components/SplitBar";
import { CompetitorWatch } from "@/components/CompetitorWatch";
import { EventLog } from "@/components/EventLog";
import { PnLTable } from "@/components/PnLTable";
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
  getPnl
} from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

export default async function Page({ searchParams }: { searchParams: { range?: string; by?: string } }) {
  const initialRange = (searchParams.range as any) ?? "14d";
  const initialBucket = (searchParams.by as any) ?? "total";

  const [kpis, leaderboard, liveSlate, nearResolution, mySummary, pnlRows, competitors, events, errors] = await Promise.all([
    getKpis(),
    Promise.resolve(getLeaderboard(initialRange as any, initialBucket as any)),
    Promise.resolve(getLiveSlate()),
    Promise.resolve(getNearResolution()),
    Promise.resolve(getMySummary("14d")),
    Promise.resolve(getPnl("14d")),
    Promise.resolve(getCompetitorWatch()),
    Promise.resolve(getEventLog()),
    Promise.resolve(getErrorLog())
  ]);

  const me = getMeAddress();
  const myRank = me ? leaderboard.findIndex((row) => row.addr === me) + 1 || null : null;
  const actionSlate = liveSlate.slice(0, 3);
  const mySummaryLabel = mySummary.length > 1 ? "Past 14 days by bucket" : "Past 14 days";

  return (
    <main className="bk-space-y-6 bk-p-6">
      <header className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-4">
        <div>
          <h1 className="bk-text-2xl">Betkiller Dash</h1>
          <p className="bk-text-muted bk-text-sm">Live edge finder across Context Markets</p>
        </div>
        {me && (
          <div className="bk-rounded-full bk-bg-accent/10 bk-px-4 bk-py-2 bk-text-sm">
            <span className="bk-text-muted">Your wallet</span>
            <span className="bk-ml-2 bk-text-accent">{me}</span>
            {myRank && myRank > 0 && <span className="bk-ml-3 bk-text-muted">Rank #{myRank}</span>}
          </div>
        )}
      </header>

      <KPIGrid items={kpis} />

      <section className="bk-grid bk-grid-cols-1 xl:bk-grid-cols-[2fr,1fr] bk-gap-6">
        <div className="bk-space-y-6">
          <LiveSlate initial={liveSlate} />
          <div className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4 bk-space-y-3">
            <header className="bk-flex bk-items-center bk-justify-between">
              <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">Action Bar</h2>
              <span className="bk-text-xs bk-text-muted">What to focus on next</span>
            </header>
            <div className="bk-space-y-2 bk-text-sm">
              {actionSlate.map((item) => (
                <div key={item.marketId} className="bk-flex bk-justify-between">
                  <span className="bk-text-accent">{item.title}</span>
                  <span className="bk-text-muted">TVL {formatMoney(item.tvl)} • Edge {item.edgeScore.toFixed(1)}</span>
                </div>
              ))}
              {actionSlate.length === 0 && <p className="bk-text-muted">No immediate calls to action.</p>}
            </div>
          </div>
          <Leaderboard initialRows={leaderboard} initialRange={initialRange as any} initialBucket={initialBucket as any} />
          <PnLTable initialRows={pnlRows} initialRange="14d" />
        </div>
        <div className="bk-space-y-6">
          <section className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4 bk-space-y-3">
            <header className="bk-flex bk-items-center bk-justify-between">
              <div>
                <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">My Rewards</h2>
                <p className="bk-text-xs bk-text-muted">{mySummaryLabel}</p>
              </div>
            </header>
            <SplitBar data={mySummary} />
            <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-xs bk-text-muted">
              {mySummary.map((item) => (
                <div key={item.bucket} className="bk-flex bk-justify-between bk-tabular-nums">
                  <span>{item.bucket}</span>
                  <span>{formatMoney(item.reward)}</span>
                </div>
              ))}
            </div>
          </section>
          <NearResolutionList initial={nearResolution} />
          <CompetitorWatch entries={competitors} />
        </div>
      </section>

      <EventLog events={events} errors={errors} />
    </main>
  );
}

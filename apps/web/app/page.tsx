import { Dashboard } from "@/components/Dashboard";
import { loadMarketDetail, loadMarkets, loadRewardEvents, loadVaultEvents } from "@/lib/queries";

export default async function Page() {
  const markets = loadMarkets();
  const initialMarketId = markets[0]?.marketId ?? null;
  const detail = initialMarketId ? loadMarketDetail(initialMarketId) : null;
  const boosts = loadVaultEvents();
  const rewards = loadRewardEvents();

  return (
    <Dashboard
      initialMarkets={markets}
      initialMarketDetail={detail}
      initialBoosts={boosts}
      initialRewards={rewards}
    />
  );
}

import { Interface, Log } from "ethers";
import abi from "./context.abi.json";
import { CONTEXT_ADDRESSES } from "../config/context.js";

const iface = new Interface(abi as any);
const EVENTS = [
  "MarketCreated",
  "MarketTraded",
  "LockUpdated",
  "StakeUpdated",
  "Unlocked",
  "SponsoredLocked",
  "EpochRootSet",
  "RewardClaimed"
] as const;
const TOPICS0 = EVENTS.map((eventName) => {
  const fragment = iface.getEvent(eventName);
  if (!fragment) throw new Error(`missing ABI fragment for ${eventName}`);
  return fragment.topicHash;
});
const LOWER_ADDRESSES = CONTEXT_ADDRESSES.map((addr) => addr.toLowerCase());

export function buildLogFilter(fromBlock: number, toBlock: number) {
  const address = LOWER_ADDRESSES.length > 0 ? [...LOWER_ADDRESSES] : undefined;
  return {
    fromBlock,
    toBlock,
    address,
    topics: [TOPICS0]
  };
}

export function accept(log: Log) {
  const address = (log.address ?? "").toLowerCase();
  const topic0 = Array.isArray(log.topics) ? log.topics[0] : undefined;
  const addressAllowed = LOWER_ADDRESSES.length === 0 || LOWER_ADDRESSES.includes(address);
  const topicAllowed = topic0 != null && TOPICS0.includes(topic0);
  return addressAllowed && topicAllowed;
}

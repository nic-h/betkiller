import { getUnclaimedClaimsForUser } from "@/context/pricing";
import { type Address, zeroAddress } from "viem";

export async function getUnclaimedClaims(user: Address): Promise<bigint> {
  if (!user || user === zeroAddress) return 0n;
  return getUnclaimedClaimsForUser(user);
}

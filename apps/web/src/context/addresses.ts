export const CONTRACT_ADDRESSES = {
  predictionMarket: "0x000000000000CE50e1e1F6f99B2E5e98e5b6c609",
  outcomeTokenImplementation: "0x70674cA9e35cca4E12926357Ed763844d276532C",
  vault: "0xE8e5dc8C7C8Fd6BfCE5E614E02F42E9cf8B72276",
  rewardDistributor: "0xc1dd1ea5b7a3e84c3EbADcc6A4f13a0F432e78a2"
} as const;

export type KnownAddressName = keyof typeof CONTRACT_ADDRESSES;

export function isKnownAddress(address: string): address is (typeof CONTRACT_ADDRESSES)[KnownAddressName] {
  const lower = address.toLowerCase();
  return Object.values(CONTRACT_ADDRESSES).some((value) => value.toLowerCase() === lower);
}

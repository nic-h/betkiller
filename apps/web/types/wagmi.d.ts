declare module 'wagmi' {
  export const WagmiConfig: any;
  export function createConfig(config: any): any;
  export function http(...args: any[]): any;
  export function useAccount(): { address?: string; isConnected: boolean; chainId?: number };
  export function useConnect(config?: any): { connect: (args?: any) => void };
  export function useDisconnect(): { disconnect: () => void };
  export function useSwitchChain(): { switchChain: (args: any) => Promise<void> };
  export function useWriteContract(): { writeContractAsync: (args: any) => Promise<any> };
}

declare module 'wagmi/chains' {
  export const base: { id: number };
}

declare module 'wagmi/connectors' {
  export function injected(): any;
}

declare module '@tanstack/react-query' {
  export class QueryClient {
    constructor(config?: any);
  }
  export const QueryClientProvider: (props: any) => any;
}

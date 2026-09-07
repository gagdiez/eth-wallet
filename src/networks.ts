import type { Network } from './types';
export const networks = {
  testnet: { chainId: 398, name: 'NEAR Protocol Testnet', ethRpc: 'https://eth-rpc.testnet.near.org', nearRpc: 'https://rpc.testnet.fastnear.com', explorer: 'https://eth-explorer-testnet.near.org' },
  mainnet: { chainId: 397, name: 'NEAR Protocol', ethRpc: 'https://eth-rpc.mainnet.near.org', nearRpc: 'https://rpc.mainnet.fastnear.com', explorer: 'https://eth-explorer.near.org' },
} as const;
export function networkConfig(network: Network) {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error('Unsupported NEAR network');
  return networks[network];
}

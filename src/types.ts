import type { Hex } from 'viem';
export type Network = 'testnet' | 'mainnet';
export type Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>;
};
export type Action = { type: string; params?: any };
export type Transaction = { receiverId: string; actions: Action[] };
export type Request = {
  kind: 'signIn' | 'signOut' | 'signAndSendTransaction' | 'signAndSendTransactions';
  network: Network;
  signerId?: string;
  receiverId?: string;
  actions?: Action[];
  transactions?: Transaction[];
  addFunctionCallKey?: unknown;
};
export type EthereumTransaction = { from: Hex; to: Hex; data: Hex; value: Hex; chainId: Hex; type: '0x0'; gasPrice?: Hex };
export const CHANNEL = 'ethereum-near-connect/v1';

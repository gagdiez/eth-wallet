import type { Network } from './types';

/** Wallet-origin storage only. The caller must supply the verified message origin. */
export class OriginGrants {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  private key(origin: string, network: Network) {
    if (new URL(origin).origin !== origin || !/^https?:/.test(origin)) throw new Error('Invalid dApp origin');
    if (network !== 'testnet' && network !== 'mainnet') throw new Error('Unsupported NEAR network');
    return `ethereum-near-connect:grant:v1:${JSON.stringify([origin, network])}`;
  }
  approve(origin: string, network: Network, account: string) {
    if (!/^0x[0-9a-f]{40}$/.test(account)) throw new Error('Invalid grant account');
    this.storage.setItem(this.key(origin, network), account);
  }
  require(origin: string, network: Network, account: string) {
    if (!/^0x[0-9a-f]{40}$/.test(account) || this.storage.getItem(this.key(origin, network)) !== account) {
      throw new Error('This site is not connected to this account on this network. Connect your wallet from the dApp first.');
    }
  }
  revoke(origin: string, network: Network) {
    this.storage.removeItem(this.key(origin, network));
  }
}

/** Serialize use of the shared provider across wallet popups, including revocation. */
export async function withWalletSession<T>(task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('This browser does not support secure wallet coordination. Use a browser with Web Locks support.');
  return navigator.locks.request('ethereum-near-connect:wallet-session', task);
}

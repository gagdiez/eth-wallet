import type { WalletManifest } from '@hot-labs/near-connect';

type Manifest = {
  version: string;
  wallets: Array<WalletManifest & { metadata?: { signPageURL: string } }>;
};

/** Resolve the local template against the separate wallet development server. */
export function createDemoManifest(template: Manifest, origin: string): Manifest {
  const url = (path: string) => new URL(path, origin).href;
  return {
    ...template,
    wallets: template.wallets.map(wallet => wallet.id !== 'ethereum-wallets' ? wallet : {
      ...wallet,
      icon: url('/ethereum.svg'),
      website: url('/wallet.html'),
      executor: url('/executor.js'),
      permissions: { ...wallet.permissions, allowsOpen: [url('/wallet.html')] },
      metadata: { ...wallet.metadata, signPageURL: url('/wallet.html') },
    }),
  };
}

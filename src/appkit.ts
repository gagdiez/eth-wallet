import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { defineChain } from '@reown/appkit/networks';
import { networkConfig } from './networks';
import type { Network, Provider } from './types';

let modal: ReturnType<typeof createAppKit> | undefined;

function getAppKit(network: Network, projectId: string, enableReconnect: boolean) {
  if (!modal) {
    const config = networkConfig(network);
    const chain = defineChain({
      id: config.chainId, name: config.name, chainNamespace: 'eip155',
      caipNetworkId: `eip155:${config.chainId}`,
      nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 },
      rpcUrls: { default: { http: [config.ethRpc] } },
      blockExplorers: { default: { name: 'NEAR Explorer', url: config.explorer } },
      testnet: network === 'testnet',
    });
    modal = createAppKit({
      adapters: [new EthersAdapter()], projectId, networks: [chain], defaultNetwork: chain,
      metadata: { name: 'Ethereum Wallets · NEAR', description: 'Your Ethereum wallet on NEAR', url: location.origin, icons: [`${location.origin}/ethereum.svg`] },
      themeMode: 'light',
      themeVariables: { '--w3m-accent': '#5265e9', '--w3m-border-radius-master': '2px', '--w3m-font-family': 'Inter, ui-sans-serif, system-ui, sans-serif' },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
      enableWalletConnect: true, enableEIP6963: true, enableCoinbase: false,
      // Transactions restore the saved session. Explicit sign-in starts a new selection.
      enableReconnect, coinbasePreference: 'eoaOnly',
      defaultAccountTypes: { eip155: 'eoa' }, allWallets: 'SHOW',
    });
  }
  return modal;
}

export async function disconnectAppKitWallet(network: Network, projectId: string): Promise<void> {
  const picker = getAppKit(network, projectId, true);
  await picker.ready();
  if (picker.getAccount('eip155')?.isConnected) await picker.disconnect('eip155');
  await picker.close();
}

export async function chooseAppKitWallet(network: Network, projectId: string, options: { reuseConnection?: boolean } = {}): Promise<Provider> {
  const reuseConnection = options.reuseConnection ?? true;
  const picker = getAppKit(network, projectId, reuseConnection);
  await picker.ready();
  // Also handle a picker already initialized in this page (for example after a retry).
  if (!reuseConnection && picker.getAccount('eip155')?.isConnected) {
    await picker.disconnect('eip155');
  }
  return new Promise<Provider>((resolve, reject) => {
    let settled = false;
    let opened = false;
    const cleanups: Array<() => void> = [];
    const finish = (provider?: Provider, error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanups.forEach(cleanup => cleanup());
      void picker.close();
      if (provider) resolve(provider);
      else reject(error ?? new Error('Wallet selection cancelled'));
    };
    const check = () => {
      const account = picker.getAccount('eip155');
      const provider = picker.getProvider<Provider>('eip155');
      if (account?.isConnected && provider) { finish(provider); return true; }
      return false;
    };
    cleanups.push(picker.subscribeAccount(check, 'eip155'));
    cleanups.push(picker.subscribeProviders(check));
    cleanups.push(picker.subscribeState(state => {
      if (state.open) opened = true;
      else if (opened && !check()) finish();
    }));
    if (!check()) void picker.open({ view: 'Connect', namespace: 'eip155' }).catch(error => finish(undefined, error));
  });
}

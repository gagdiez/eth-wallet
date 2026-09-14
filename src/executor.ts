import { CHANNEL, type Network, type Request } from './types';

// The executor only uses the near-connect sandbox API. Wallet providers live on the wallet page.
declare const window: Window & { selector: any };
const key = (network: Network) => `account:${network}`;
const unsupported = async () => { throw new Error('This Ethereum wallet does not support this NEAR operation'); };

export function requestWallet(selector: any, signPageURL: string, payload: Request): Promise<any> {
  const url = new URL(signPageURL);
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  url.hash = new URLSearchParams({ requestId, origin: new URL(selector.location).origin }).toString();
  return new Promise((resolve, reject) => {
    let sent = false;
    let settled = false;
    const popup = selector.open(url.toString());
    const cleanup = (closePopup = true) => {
      settled = true;
      window.removeEventListener('message', handler);
      clearInterval(poll);
      clearTimeout(timeout);
      if (closePopup) popup.close();
    };
    const handler = (event: MessageEvent) => {
      const message = event.data;
      // near-connect validates popup origin and forwards the message through its sandbox.
      // A cryptographic per-request token prevents another same-origin popup from answering.
      if (!message || message.channel !== CHANNEL || message.requestId !== requestId) return;
      if (message.type === 'READY') {
        // READY may repeat after a slow load or a refresh of the approval page.
        // Re-deliver the same request; the page accepts it only once per load.
        sent = true;
        popup.postMessage({ channel: CHANNEL, requestId, type: 'REQUEST', payload });
      } else if (sent && message.type === 'RESULT') {
        cleanup(); resolve(message.result);
      } else if (sent && message.type === 'ERROR') {
        // Keep the wallet's error and any submitted transaction hash visible.
        cleanup(false); reject(new Error(message.error));
      }
    };
    window.addEventListener('message', handler);
    const poll = setInterval(() => {
      if (popup.closed && !settled) { cleanup(); reject(new Error('Wallet window closed; check submitted transactions before retrying')); }
    }, 300);
    const timeout = setTimeout(() => {
      cleanup(); reject(new Error('Wallet request timed out; check submitted transactions before retrying'));
    }, 10 * 60_000);
    popup.windowIdPromise.then((id: string | null) => {
      if (!id && !settled) { cleanup(); reject(new Error('Popup blocked. Allow popups and try again.')); }
    }, (error: unknown) => { if (!settled) { cleanup(); reject(error); } });
  });
}

const wallet = {
  manifest: {} as { metadata: { signPageURL: string } },
  async signIn(data: any = {}) {
    if (data.addFunctionCallKey) throw new Error('Sign-in access keys are not supported; connect without addFunctionCallKey');
    const network = data.network ?? 'testnet';
    const accounts = await requestWallet(window.selector, this.manifest.metadata.signPageURL, { kind: 'signIn', network });
    if (!Array.isArray(accounts) || !/^0x[0-9a-f]{40}$/.test(accounts[0]?.accountId)) throw new Error('Invalid wallet account response');
    await window.selector.storage.set(key(network), accounts[0].accountId);
    return accounts;
  },
  async getAccounts(data: any = {}) {
    const accountId = await window.selector.storage.get(key(data.network ?? 'testnet'));
    return accountId ? [{ accountId }] : [];
  },
  async signOut(data: any = {}) {
    const network = data.network ?? 'testnet';
    await requestWallet(window.selector, this.manifest.metadata.signPageURL, { kind: 'signOut', network });
    await window.selector.storage.remove(key(network));
  },
  async send(data: any, kind: Request['kind']) {
    const network = data.network ?? 'testnet';
    const accountId = await window.selector.storage.get(key(network));
    if (!accountId) throw new Error('Connect the Ethereum wallet first');
    if (data.signerId && data.signerId !== accountId) throw new Error('Signer does not match the connected account');
    return requestWallet(window.selector, this.manifest.metadata.signPageURL, { ...data, kind, network, signerId: accountId });
  },
  async signAndSendTransaction(data: any) { return this.send(data, 'signAndSendTransaction'); },
  async signAndSendTransactions(data: any) { return this.send(data, 'signAndSendTransactions'); },
  signMessage: unsupported,
  signInAndSignMessage: unsupported,
  signDelegateActions: unsupported,
};
if (typeof window !== 'undefined' && window.selector) window.selector.ready(wallet);

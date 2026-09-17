import { NearConnector, type WalletManifest } from '@hot-labs/near-connect';
import { formatUnits, parseUnits } from 'viem';
import { queryNear, network, explorer } from './near';
import './style.css';

document.querySelector('#app')!.innerHTML = `
  <span class="badge">${network.toUpperCase()} · NEP-518</span><h1>Your Ethereum wallet.<br>Native NEAR transactions.</h1>
  <p>Connect a NEAR wallet, or use MetaMask through Ethereum Wallets, then transfer NEAR or call a NEAR contract.</p>
  <section><h2>1. Connect</h2><button id="connect">Connect</button><button id="disconnect" class="secondary">Disconnect</button>
    <p id="account">Not connected</p><p id="connection-status" role="status"></p><p id="balance" class="muted"></p>
    <p class="muted">When using Ethereum Wallets, new <code>0x…</code> accounts are set up through a sponsored relayer transaction during login. Add NEAR to that account for transfers and contract calls; the demo does not use Ethereum ETH.</p></section>
  <section><h2>2. Send NEAR</h2><label>NEAR recipient<input id="recipient" value="${network === 'testnet' ? 'influencer.testnet' : 'gagdiez.near'}"></label>
    <label>Amount (NEAR)<input id="amount" value="0.001" inputmode="decimal"></label><button id="transfer">Review transfer</button></section>
  <section><h2>3. Call a NEAR contract</h2><p class="muted">${network === 'testnet' ? 'The guest-book example calls <code>addMessage</code>.' : 'Enter a mainnet contract and method.'} You can choose your own contract and JSON arguments.</p>
    <label>Contract<input id="contract" value="${network === 'testnet' ? 'guest-book.testnet' : ''}"></label><label>Method<input id="method" value="${network === 'testnet' ? 'addMessage' : ''}"></label>
    <label>JSON arguments<textarea id="args">{"text":"Hello NEAR, signed with my Ethereum wallet!"}</textarea></label>
    <p class="muted">Attached gas: 30 Tgas</p><label>Deposit (NEAR)<input id="deposit" value="0"></label><button id="call">Review contract call</button>
    <button id="messages" class="secondary" ${network === 'mainnet' ? 'hidden' : ''}>Read guest-book messages</button></section>
  <section><h2>Result</h2><p id="status" role="status">Ready to connect.</p><div id="links"></div><pre id="result">Final NEAR execution outcomes will appear here.</pre></section>`;
const ethereumManifestUrl = import.meta.env.VITE_WALLET_MANIFEST_URL
  || 'https://evm-on-near.dev/manifest.json';
const connector = new NearConnector({ network, autoConnect: false });
const manifestResponse = await fetch(ethereumManifestUrl);
if (!manifestResponse.ok) throw new Error('Could not load the demo wallet manifest');
const ethereumManifest = await manifestResponse.json() as { wallets: WalletManifest[] };
await connector.whenManifestLoaded;
await Promise.all(ethereumManifest.wallets.map(wallet => connector.registerWallet(wallet)));
const element = (id: string) => document.getElementById(id)!;
const value = (id: string) => (element(id) as HTMLInputElement).value;
const print = (result: unknown) => { element('result').textContent = JSON.stringify(result, null, 2); };
let accountId: string | undefined;
function yocto(input: string) {
  if (!/^\d+(\.\d{1,24})?$/.test(input)) throw new Error('Enter a nonnegative NEAR amount with at most 24 decimal places');
  return parseUnits(input, 24).toString();
}
async function refresh() {
  element('account').textContent = accountId ?? 'Not connected';
  element('balance').textContent = '';
  if (accountId) {
    try {
      const account = await queryNear({ request_type: 'view_account', finality: 'final', account_id: accountId });
      element('balance').textContent = `Balance: ${formatUnits(BigInt(account.amount), 24)} NEAR`;
    } catch { element('balance').textContent = 'Account is unfunded or the RPC could not load its balance.'; }
  }
}
function handle(id: string, task: () => Promise<void>) {
  element(id).addEventListener('click', async () => {
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    element('status').textContent = 'Working…';
    if (id === 'connect') element('connection-status').textContent = 'Connecting…';
    try { await task(); element('status').textContent = 'Complete.'; }
    catch (error: any) {
      const message = error?.message ?? String(error);
      element('status').textContent = message;
      if (id === 'connect') {
        element('connection-status').textContent = `Login did not complete: ${message}`;
        element('connection-status').setAttribute('role', 'alert');
      }
    }
    finally { document.querySelectorAll('button').forEach(b => b.disabled = false); }
  });
}
handle('connect', async () => {
  const wallet = await connector.connect();
  accountId = (await wallet.getAccounts())[0]?.accountId;
  if (!accountId) throw new Error('The wallet returned no connected account');
  element('connection-status').setAttribute('role', 'status');
  element('connection-status').textContent = 'Connected.';
  await refresh();
});
handle('disconnect', async () => { await connector.disconnect(); accountId = undefined; element('connection-status').textContent = ''; await refresh(); });
async function send(receiverId: string, action: any) {
  if (!accountId) throw new Error('Connect your wallet first');
  const wallet = await connector.wallet();
  const outcome = await wallet.signAndSendTransaction({ signerId: accountId, receiverId, actions: [action] });
  print(outcome);
  element('links').replaceChildren();
  const link = document.createElement('a');
  link.textContent = 'View NEAR transaction';
  link.href = `${explorer}/txns/${encodeURIComponent(outcome.transaction.hash)}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer'; element('links').append(link);
  await refresh();
}
handle('transfer', async () => send(value('recipient'), { type: 'Transfer', params: { deposit: yocto(value('amount')) } }));
handle('call', async () => send(value('contract'), { type: 'FunctionCall', params: { methodName: value('method'), args: JSON.parse(value('args')), gas: '30000000000000', deposit: yocto(value('deposit')) } }));
handle('messages', async () => {
  const result = await queryNear({ request_type: 'call_function', finality: 'final', account_id: 'guest-book.testnet', method_name: 'getMessages', args_base64: btoa('{}') });
  print(JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))));
});

// Restore the account already saved by near-connect and the wallet executor.
// Do not call connect(): reloading the dApp must not open another wallet prompt.
document.querySelectorAll('button').forEach(button => button.disabled = true);
element('account').textContent = 'Restoring connection…';
element('status').textContent = 'Restoring connection…';
try {
  const { accounts } = await connector.getConnectedWallet();
  accountId = accounts[0]?.accountId;
  element('status').textContent = 'Connected.';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  element('status').textContent = ['No wallet selected', 'No accounts found'].includes(message)
    ? 'Ready to connect.'
    : `Could not restore the connection: ${message}`;
} finally {
  document.querySelectorAll('button').forEach(button => button.disabled = false);
}
void refresh();

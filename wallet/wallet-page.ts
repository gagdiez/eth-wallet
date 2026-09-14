import { errorMessage } from '../src/errors';
import { OriginGrants, withWalletSession } from '../src/grants';
import { receiveRequest } from '../src/sign-page';
import { EthereumNearWallet } from '../src/wallet';
import { encodeTransactions } from '../src/encoding';
import { formatUnits } from 'viem';
import type { Transaction } from '../src/types';
import './wallet.css';

document.querySelector('#app')!.innerHTML = `
  <div class="brand"><img src="./ethereum.svg" alt=""><span>Ethereum Wallets <span class="brand-divider">/</span> NEAR</span></div>
  <article class="approval-card" aria-labelledby="title">
    <header class="card-header"><span id="network" class="network-badge">NEAR</span></header>
    <div class="connection-art" aria-hidden="true"><span class="chain-icon"><img src="./ethereum.svg" alt=""></span><span class="connection-dots">···</span><span class="near-icon"><img src="./near.svg" alt=""></span></div>
    <h1 id="title">Connect your wallet</h1>
    <div id="origin" class="origin-pill" hidden></div>
    <p class="explanation">Use your Ethereum wallet on NEAR</p>

    <div id="transactions" class="transactions" hidden></div>
    <details id="raw-details" hidden><summary>Transaction details</summary><pre id="details"></pre></details>
    <button id="approve" class="primary" aria-live="polite" disabled>Loading…</button>
    <p id="status" role="alert" class="status error" hidden></p>
    <footer class="card-footer"><span aria-hidden="true">◇</span> Your keys stay in your wallet.</footer>
  </article>
  <p class="page-footer">Built by NEAR Dev</p>`;
const el = (id: string) => document.getElementById(id)!;
const approve = el('approve') as HTMLButtonElement;

function setBusy(busy: boolean, label: string) {
  approve.disabled = busy;
  approve.textContent = label;
  approve.classList.toggle('busy', busy);
  approve.setAttribute('aria-busy', String(busy));
}
function showError(message = '') {
  el('status').textContent = message;
  el('status').hidden = !message;
}
function showTransactions(transactions: Transaction[]) {
  const container = el('transactions');
  container.replaceChildren();
  container.hidden = false;
  for (const tx of transactions) {
    const action = tx.actions[0];
    const row = document.createElement('div'); row.className = 'transaction-row';
    const heading = document.createElement('strong');
    heading.textContent = action.type === 'Transfer'
      ? `Transfer ${formatUnits(BigInt(action.params.deposit), 24)} NEAR`
      : action.type === 'FunctionCall'
        ? `Call ${action.params.methodName}`
        : action.type === 'AddKey' ? 'Add access key' : 'Remove access key';
    const recipient = document.createElement('span');
    recipient.textContent = `${action.type === 'Transfer' ? 'To' : action.type === 'FunctionCall' ? 'Contract' : 'Account'}: ${tx.receiverId}`;
    row.append(heading, recipient);
    if (action.type === 'FunctionCall') {
      const deposit = document.createElement('small');
      deposit.textContent = `Attached deposit: ${formatUnits(BigInt(action.params.deposit), 24)} NEAR`;
      row.append(deposit);
    }
    container.append(row);
  }
}

async function main() {
  setBusy(true, 'Loading…');
  showError();
  const request = await receiveRequest();
  const { payload } = request;
  const grants = new OriginGrants(localStorage);
  if (payload.kind === 'signOut') {
    setBusy(true, 'Disconnecting…');
    try {
      await withWalletSession(async () => { grants.revoke(request.origin, payload.network); });
      request.respond(null);
      setBusy(true, 'Disconnected');
    } catch (error) {
      request.fail(error);
      showError(errorMessage(error));
      setBusy(false, 'Disconnect failed');
      approve.disabled = true;
    }
    return;
  }
  const isLogin = payload.kind === 'signIn';
  el('network').textContent = payload.network === 'testnet' ? 'NEAR Testnet' : 'NEAR Mainnet';
  el('title').textContent = isLogin ? 'Connect to this site' : 'Review transaction';
  el('origin').textContent = request.origin;
  el('origin').hidden = false;
  const txs: Transaction[] = isLogin ? [] : payload.kind === 'signAndSendTransactions' ? payload.transactions! : [{ receiverId: payload.receiverId!, actions: payload.actions! }];
  try {
    if (!isLogin) {
      if (!payload.signerId) throw new Error('Missing signing account');
      grants.require(request.origin, payload.network, payload.signerId);
      encodeTransactions(txs, payload.signerId as `0x${string}`, payload.network);
    }
  } catch (error) {
    request.fail(error);
    showError(errorMessage(error));
    setBusy(false, 'Request rejected');
    approve.disabled = true;
    return;
  }
  if (!isLogin) {
    showTransactions(txs);
    el('raw-details').hidden = false;
    el('details').textContent = JSON.stringify({ signerId: payload.signerId, network: payload.network, transactions: txs }, null, 2);
  }
  const buttonLabel = isLogin ? 'Connect Wallet' : 'Confirm Transaction';
  setBusy(false, buttonLabel);
  showError();
  const connect = async () => {
    setBusy(true, 'Connecting…');
    showError();
    let submissionStarted = false;
    try {
      setBusy(true, 'Waiting for wallet…');
      await withWalletSession(async () => {
        if (!isLogin) grants.require(request.origin, payload.network, payload.signerId!);
        const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
        if (!projectId) {
          console.error('Configure VITE_WALLETCONNECT_PROJECT_ID in .env.local and restart Vite.');
          throw new Error('Wallet connection is not configured yet. Please try again once setup is complete.');
        }
        const { chooseAppKitWallet } = await import('../src/appkit');
        const provider = await chooseAppKitWallet(payload.network, projectId, { reuseConnection: true });
        setBusy(true, 'Confirm in wallet…');
        const wallet = new EthereumNearWallet(provider, payload.network, (_message, stage) => {
          const labels = { checking: 'Checking account…', onboarding: 'Approve setup…', confirming: 'Confirm in wallet…', submitted: 'Confirming…' };
          setBusy(true, labels[stage]);
        });
        if (isLogin) {
          // Onboarding can submit a transaction. Surface errors to the dApp rather
          // than leave an approval button that could blindly resubmit after a timeout.
          submissionStarted = true;
          const address = await wallet.signIn();
          grants.approve(request.origin, payload.network, address);
          request.respond([{ accountId: address }]);
        } else {
          const address = await wallet.connect();
          if (address !== payload.signerId) throw new Error('This wallet account differs from the connected NEAR account. Reconnect the dApp with the account you want to use.');
          submissionStarted = true;
          const outcomes = await wallet.sendTransactions(txs, address);
          request.respond(payload.kind === 'signAndSendTransaction' ? outcomes[0] : outcomes);
        }
      });
      setBusy(false, isLogin ? 'Connected' : 'Complete');
      approve.disabled = true;
    } catch (error) {
      const message = errorMessage(error);
      showError(message === 'Wallet selection cancelled' ? '' : message);
      if (submissionStarted) {
        setBusy(false, isLogin ? 'Setup failed' : 'Transaction failed');
        approve.disabled = true;
        request.fail(error);
      } else { setBusy(false, buttonLabel); }
    }
  };
  approve.onclick = () => { void connect(); };
  // Connecting requires an explicit click on this page, even with a restored provider.
}
async function loadRequest() {
  try { await main(); }
  catch (error) {
    showError(errorMessage(error));
    setBusy(false, 'Retry request');
    approve.onclick = () => { void loadRequest(); };
  }
}
void loadRequest();

import { errorMessage } from './errors';
import { base58 } from '@scure/base';
import { hexToBytes, toHex, type Hex } from 'viem';
import { encodeAction, encodeTransactions } from './encoding';
import { networkConfig } from './networks';
import { rpc, RpcError, sleep } from './rpc';
import type { EthereumTransaction, Network, Provider, Transaction } from './types';

export class SubmissionError extends Error {
  constructor(message: string, public readonly ethereumHash?: string, public readonly completedOutcomes: unknown[] = []) { super(message); }
}

export type WalletProgress = 'checking' | 'onboarding' | 'confirming' | 'submitted';

export class EthereumNearWallet {
  constructor(readonly provider: Provider, readonly network: Network, readonly progress: (message: string, stage: WalletProgress) => void = () => {}, readonly timeoutMs = 120_000) {
    networkConfig(network);
  }
  async connect(): Promise<Hex> {
    const connected = await this.provider.request({ method: 'eth_accounts' });
    const accounts = connected?.length ? connected : await this.provider.request({ method: 'eth_requestAccounts' });
    const address = accounts?.[0];
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('No Ethereum account selected');
    await this.switchChain();
    return address.toLowerCase() as Hex;
  }
  async signIn(): Promise<Hex> {
    const address = await this.connect();
    this.progress(`Checking your NEAR account: ${address}`, 'checking');
    // Equivalent to the old module's alwaysOnboardDuringSignIn option.
    // The relayer sponsors its restricted AddKey operation for missing accounts/keys.
    await this.ensureOnboarded(address);
    await this.assertSigner(address);
    return address;
  }
  async switchChain() {
    const config = networkConfig(this.network);
    const chainId = toHex(config.chainId);
    if (BigInt(await this.provider.request({ method: 'eth_chainId' })) === BigInt(config.chainId)) return;
    try {
      await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    } catch (error: any) {
      if (error?.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
      await this.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: config.name,
        nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 }, rpcUrls: [config.ethRpc], blockExplorerUrls: [config.explorer] }] });
      await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
    await this.assertChain();
  }
  private async assertChain() {
    if (BigInt(await this.provider.request({ method: 'eth_chainId' })) !== BigInt(networkConfig(this.network).chainId)) throw new Error('Ethereum wallet is on the wrong network');
  }
  private async assertSigner(address: Hex) {
    await this.assertChain();
    const accounts = await this.provider.request({ method: 'eth_accounts' });
    if (accounts?.[0]?.toLowerCase() !== address) throw new Error('Ethereum account changed. Reconnect before submitting.');
  }
  async ensureOnboarded(address: Hex) {
    const config = networkConfig(this.network);
    const result = await rpc(config.ethRpc, 'near_getPublicKey');
    if (typeof result?.public_key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(result.public_key)) throw new Error('Relayer returned an invalid public key');
    const publicKey = `ed25519:${base58.encode(hexToBytes(`0x${result.public_key}`))}`;
    try {
      const access = await rpc(config.nearRpc, 'query', { request_type: 'view_access_key', finality: 'final', account_id: address, public_key: publicKey });
      const permission = access.permission?.FunctionCall;
      if (!permission || permission.receiver_id !== address || (permission.method_names.length && !permission.method_names.includes('rlp_execute'))) throw new Error('Existing relayer key has unexpected permissions');
      return;
    } catch (error) {
      // Only missing accounts/keys justify onboarding; transport and other RPC errors must surface.
      if (!(error instanceof RpcError) || !/UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|does not exist|doesn't exist|has never been observed/.test(error.message)) throw error;
    }
    this.progress('Set up your NEAR account: approve the sponsored relayer transaction in your Ethereum wallet. The key can only call rlp_execute on your own account.', 'onboarding');
    const tx = encodeAction(address, { type: 'AddKey', params: { publicKey, accessKey: { permission: { receiverId: address, methodNames: ['rlp_execute'] } } } }, address, this.network);
    // The relayer recognizes this onboarding operation and sponsors it. Some wallets reject zero gas price.
    tx.gasPrice = '0x1';
    await this.submit(tx, address);
  }
  private async submit(transaction: EthereumTransaction, address: Hex) {
    await this.assertSigner(address);
    const hash = await this.provider.request({ method: 'eth_sendTransaction', params: [transaction] });
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SubmissionError('Wallet returned an invalid transaction hash');
    this.progress(`Submitted ${hash}. Waiting for NEAR execution…`, 'submitted');
    try {
      return await this.waitForOutcome(hash, address);
    } catch (error) {
      throw new SubmissionError(`${errorMessage(error)}. Ethereum hash: ${hash}. Check its status before retrying.`, hash);
    }
  }
  async waitForOutcome(hash: string, address: string) {
    const config = networkConfig(this.network);
    const deadline = Date.now() + this.timeoutMs;
    let receipt;
    while (Date.now() < deadline) {
      receipt = await rpc(config.ethRpc, 'eth_getTransactionReceipt', [hash]);
      if (receipt) break;
      await sleep(1_000);
    }
    if (!receipt) throw new Error('Timed out waiting for Ethereum receipt');
    if (!receipt.nearTransactionHash) throw new Error('Relayer receipt is missing nearTransactionHash');
    while (Date.now() < deadline) {
      let outcome;
      try {
        outcome = await rpc(config.nearRpc, 'tx', { tx_hash: receipt.nearTransactionHash, sender_account_id: address, wait_until: 'FINAL' });
      } catch (error) {
        if (!(error instanceof RpcError) || !/UNKNOWN_TRANSACTION|TIMEOUT_ERROR/.test(error.message)) throw error;
        await sleep(1_000);
        continue;
      }
      if (!outcome || !outcome.transaction_outcome || !Array.isArray(outcome.receipts_outcome)) throw new Error('Invalid NEAR execution outcome');
      const failure = [outcome, outcome.transaction_outcome.outcome, ...outcome.receipts_outcome.map((r: any) => r.outcome)].find(o => o.status && typeof o.status === 'object' && 'Failure' in o.status);
      if (failure || receipt.status === '0x0') throw new Error(`NEAR execution failed: ${JSON.stringify(failure?.status ?? receipt)}`);
      if (!outcome.status || typeof outcome.status !== 'object' || !('SuccessValue' in outcome.status)) {
        await sleep(1_000);
        continue;
      }
      return outcome;
    }
    throw new Error('Timed out waiting for final NEAR outcome');
  }
  async sendTransactions(transactions: Transaction[], expectedSigner: string) {
    if (!/^0x[0-9a-f]{40}$/.test(expectedSigner)) throw new Error('Invalid signer; reconnect your wallet');
    const address = expectedSigner as Hex;
    // Validate the whole batch before prompting for or submitting any transaction.
    const encoded = encodeTransactions(transactions, address, this.network);
    await this.assertSigner(address);
    await this.ensureOnboarded(address);
    const outcomes: unknown[] = [];
    for (const [index, transaction] of encoded.entries()) {
      this.progress(`Approve transaction ${index + 1} of ${encoded.length} in your Ethereum wallet.`, 'confirming');
      try { outcomes.push(await this.submit(transaction, address)); }
      catch (error) {
        throw new SubmissionError(`${outcomes.length} of ${encoded.length} requested transactions completed. ${errorMessage(error)}`, error instanceof SubmissionError ? error.ethereumHash : undefined, outcomes);
      }
    }
    return outcomes;
  }
}

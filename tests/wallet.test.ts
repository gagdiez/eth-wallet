import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData } from 'viem';
import { ABI } from '../src/encoding';
import { EthereumNearWallet, SubmissionError } from '../src/wallet';
const address = '0x1234567890123456789012345678901234567890';
const hash = `0x${'ab'.repeat(32)}`;
const outcome = { status: { SuccessValue: '' }, transaction: { hash: 'nearHash' }, transaction_outcome: { outcome: { status: { SuccessReceiptId: 'receipt' } } }, receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }] };
const tx = { receiverId: 'alice.testnet', actions: [{ type: 'Transfer', params: { deposit: '1' } }] };
function setup(options: { missing?: boolean | 'account'; legacyQueryError?: string; rpcError?: boolean; changed?: boolean; failure?: boolean; rejected?: boolean } = {}) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0x18e';
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [options.changed ? `0x${'2'.repeat(40)}` : address];
    if (method === 'eth_sendTransaction') {
      if (options.rejected) throw Object.assign(new Error('User rejected'), { code: 4001 });
      return hash;
    }
    return null;
  });
  const fetchMock = vi.fn(async (_url: any, init: any) => {
    const { method } = JSON.parse(init.body);
    let result: any;
    let error: any;
    if (method === 'near_getPublicKey') result = { public_key: '11'.repeat(32) };
    if (method === 'query') {
      if (options.legacyQueryError) result = { block_hash: 'block', block_height: 267531265, error: options.legacyQueryError, logs: [] };
      else if (options.missing) error = { cause: { name: options.missing === 'account' ? 'UNKNOWN_ACCOUNT' : 'UNKNOWN_ACCESS_KEY' } };
      else if (options.rpcError) error = { cause: { name: 'INTERNAL_ERROR' } };
      else result = { permission: { FunctionCall: { receiver_id: address, method_names: ['rlp_execute'] } } };
    }
    if (method === 'eth_getTransactionReceipt') result = { nearTransactionHash: 'nearHash', status: '0x1' };
    if (method === 'tx') result = options.failure ? { ...outcome, receipts_outcome: [{ outcome: { status: { Failure: { ActionError: 'contract failed' } } } }] } : outcome;
    return new Response(JSON.stringify(error ? { error } : { result }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { request, fetchMock, wallet: new EthereumNearWallet({ request }, 'testnet') };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('wallet execution', () => {
  it('preserves nested plain-object provider errors without retrying', async () => {
    const { wallet, request } = setup();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async input => {
      if (input.method === 'eth_sendTransaction') throw {
        code: -32603, message: 'Internal JSON-RPC error.',
        data: { originalError: { message: 'Gas cannot exceed 300 Tgas on NEAR' } },
      };
      return original(input);
    });
    await expect(wallet.sendTransactions([tx], address)).rejects.toThrow(
      '0 of 1 requested transactions completed. Internal JSON-RPC error.: Gas cannot exceed 300 Tgas on NEAR',
    );
    expect(request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('onboards when the live RPC reports a missing key inside result.error', async () => {
    const { wallet, request } = setup({ legacyQueryError: 'access key ed25519:3HDMUBDSSup8jPL7FMLiduSPwir6HhX4zedvZmzy25So does not exist while viewing' });
    expect(await wallet.signIn()).toBe(address);
    const submissions = request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction');
    expect(submissions).toHaveLength(1);
    expect((submissions[0][0] as any).params[0].gasPrice).toBe('0x1');
  });
  it('does not onboard when a legacy query reports an unrelated failure', async () => {
    const { wallet, request } = setup({ legacyQueryError: 'Database unavailable' });
    await expect(wallet.signIn()).rejects.toThrow('Database unavailable');
    expect(request.mock.calls.some(([p]) => p.method === 'eth_sendTransaction')).toBe(false);
  });
  it('signs in existing onboarded accounts without submitting a transaction', async () => {
    const { wallet, request } = setup();
    expect(await wallet.signIn()).toBe(address);
    expect(request.mock.calls.some(([p]) => p.method === 'eth_sendTransaction')).toBe(false);
  });
  it.each(['account', true] as const)('onboards a missing account/key during sign-in: %s', async missing => {
    const { wallet, request } = setup({ missing });
    expect(await wallet.signIn()).toBe(address);
    const submissions = request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction');
    expect(submissions).toHaveLength(1);
    const onboarding = (submissions[0][0] as any).params[0];
    expect(onboarding.gasPrice).toBe('0x1');
    expect(onboarding.value).toBe('0x0');
    expect(decodeFunctionData({ abi: ABI, data: onboarding.data }).args?.slice(3)).toEqual([false, false, 0n, address, ['rlp_execute']]);
  });
  it('waits for final onboarding before reporting a successful login', async () => {
    const { wallet } = setup({ missing: 'account' });
    let confirm!: (result: typeof outcome) => void;
    const wait = vi.spyOn(wallet, 'waitForOutcome').mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const completed = vi.fn();
    const pending = wallet.signIn().then(completed);
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    expect(completed).not.toHaveBeenCalled();
    confirm(outcome);
    await pending;
    expect(completed).toHaveBeenCalledWith(address);
  });
  it.each([{ missing: 'account' as const, rejected: true }, { missing: 'account' as const, failure: true }, { rpcError: true }])('does not report login success if onboarding cannot complete: %j', async options => {
    const { wallet } = setup(options);
    await expect(wallet.signIn()).rejects.toThrow();
  });
  it('reuses an authorized account on NEAR without connection or switch prompts', async () => {
    const { wallet, request } = setup();
    expect(await wallet.connect()).toBe(address);
    expect(request).toHaveBeenCalledWith({ method: 'eth_accounts' });
    expect(request.mock.calls.some(([p]) => p.method === 'eth_requestAccounts' || p.method === 'wallet_switchEthereumChain')).toBe(false);
  });
  it('requests connection and switches chains when necessary', async () => {
    let chain = '0x1';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [];
      if (method === 'eth_requestAccounts') return [address];
      if (method === 'eth_chainId') return chain;
      if (method === 'wallet_switchEthereumChain') chain = '0x18e';
      return null;
    });
    expect(await new EthereumNearWallet({ request }, 'testnet').connect()).toBe(address);
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x18e' }] });
  });
  it('returns the actual final NEAR outcome', async () => {
    const { wallet, request } = setup();
    expect(await wallet.sendTransactions([tx], address)).toEqual([outcome]);
    expect(request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('onboards with a sponsored restricted key, excluding onboarding from returned outcomes', async () => {
    const { wallet, request } = setup({ missing: true });
    expect(await wallet.sendTransactions([tx], address)).toEqual([outcome]);
    const submissions = request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction');
    expect(submissions).toHaveLength(2);
    const onboarding = (submissions[0][0] as any).params[0];
    expect(onboarding.gasPrice).toBe('0x1');
    expect(decodeFunctionData({ abi: ABI, data: onboarding.data }).args?.slice(3)).toEqual([false, false, 0n, address, ['rlp_execute']]);
  });
  it.each([{ rpcError: true }, { changed: true }])('never submits on RPC failure or signer change: %j', async options => {
    const { wallet, request } = setup(options);
    await expect(wallet.sendTransactions([tx], address)).rejects.toThrow();
    expect(request.mock.calls.some(([p]) => p.method === 'eth_sendTransaction')).toBe(false);
  });
  it('does not submit any transaction from an invalid batch', async () => {
    const { wallet, request } = setup();
    await expect(wallet.sendTransactions([tx, { receiverId: address, actions: [{ type: 'Stake' }] }], address)).rejects.toThrow('Unsupported');
    expect(request).not.toHaveBeenCalled();
  });
  it('detects failed nested receipts even when the outer outcome succeeds', async () => {
    const { wallet } = setup({ failure: true });
    await expect(wallet.sendTransactions([tx], address)).rejects.toThrow('contract failed');
  });
  it('does not resubmit after a user rejection', async () => {
    const { wallet, request } = setup({ rejected: true });
    await expect(wallet.sendTransactions([tx], address)).rejects.toThrow('User rejected');
    expect(request.mock.calls.filter(([p]) => p.method === 'eth_sendTransaction')).toHaveLength(1);
  });
  it('reports partial batch completion and the submitted hash', async () => {
    const { wallet } = setup();
    vi.spyOn(wallet, 'waitForOutcome').mockResolvedValueOnce(outcome).mockRejectedValueOnce(new Error('Timed out'));
    try { await wallet.sendTransactions([tx, tx], address); expect.fail('Expected an error'); }
    catch (error) {
      expect(error).toBeInstanceOf(SubmissionError);
      expect((error as SubmissionError).completedOutcomes).toEqual([outcome]);
      expect((error as SubmissionError).ethereumHash).toBe(hash);
      expect((error as Error).message).toContain('1 of 2');
    }
  });
});

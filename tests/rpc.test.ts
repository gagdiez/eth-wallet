import { afterEach, expect, it, vi } from 'vitest';
import { rpc, RpcError } from '../src/rpc';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { error: { cause: { name: 'UNKNOWN_ACCOUNT' } } },
  { result: { block_hash: 'block', block_height: 267531265, error: 'access key does not exist while viewing', logs: [] } },
])('rejects both NEAR query error envelopes: %j', async body => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }))));
  await expect(rpc('https://rpc.testnet.fastnear.com', 'query', {})).rejects.toBeInstanceOf(RpcError);
});

it('preserves a valid access-key response', async () => {
  const result = { nonce: 12, permission: { FunctionCall: { receiver_id: 'account', method_names: ['rlp_execute'], allowance: null } } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result }))));
  expect(await rpc('https://rpc.testnet.fastnear.com', 'query', {})).toEqual(result);
});

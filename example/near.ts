const configuredNetwork = import.meta.env.VITE_NEAR_NETWORK || 'testnet';
if (configuredNetwork !== 'testnet' && configuredNetwork !== 'mainnet') {
  throw new Error('VITE_NEAR_NETWORK must be testnet or mainnet');
}
export const network = configuredNetwork;
export const nearRpc = network === 'mainnet'
  ? 'https://rpc.mainnet.fastnear.com'
  : 'https://rpc.testnet.fastnear.com';
export const explorer = network === 'mainnet'
  ? 'https://nearblocks.io'
  : 'https://testnet.nearblocks.io';

/** Read-only dApp queries; signing happens through near-connect. */
export async function queryNear(params: Record<string, unknown>) {
  const response = await fetch(nearRpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error || body.result.error));
  if (!body.result) throw new Error('Invalid NEAR RPC response');
  return body.result;
}

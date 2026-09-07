export class RpcError extends Error {
  constructor(public readonly details: any) { super(JSON.stringify(details)); }
}
export async function rpc<T = any>(url: string, method: string, params: unknown = []): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status} at ${url}`);
  const body = await response.json();
  if (body.error) throw new RpcError(body.error);
  if (!('result' in body)) throw new Error('Invalid RPC response');
  // NEAR's legacy query endpoint can return failures inside a successful JSON-RPC
  // envelope. JsonRpcProvider.query in near-api-js handles this form as well.
  if (method === 'query' && body.result?.error) throw new RpcError(body.result.error);
  return body.result as T;
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

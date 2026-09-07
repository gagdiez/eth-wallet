import { base58 } from '@scure/base';
import { bytesToHex, encodeFunctionData, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { networkConfig } from './networks';
import type { Action, EthereumTransaction, Network, Transaction } from './types';

// NEP-518 wallet contract ABI; compatible with the original wallet-selector module.
export const ABI = parseAbi([
  'function functionCall(string receiver_id, string method_name, bytes args, uint64 gas, uint32 yoctoNear) payable',
  'function transfer(string receiver_id, uint32 yoctoNear) payable',
  'function addKey(uint8 public_key_kind, bytes public_key, uint64 nonce, bool is_full_access, bool is_limited_allowance, uint128 allowance, string receiver_id, string[] method_names)',
  'function deleteKey(uint8 public_key_kind, bytes public_key)',
]);
// Leave 30 Tgas of wrapper headroom below the relayer's 300 Tgas ceiling.
export const MAX_GAS = 270_000_000_000_000n;
const U128_MAX = (1n << 128n) - 1n;
function amount(value: unknown, max = U128_MAX): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Amounts must be unsigned decimal strings');
  const n = BigInt(value);
  if (n > max) throw new Error('Amount exceeds protocol limit');
  return n;
}
export function accountId(value: string): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) throw new Error('Invalid NEAR account ID');
  return value;
}
function key(value: string): Hex {
  if (typeof value !== 'string' || !value.startsWith('ed25519:')) throw new Error('Only ed25519 access keys are supported');
  const bytes = base58.decode(value.slice(8));
  if (bytes.length !== 32) throw new Error('Invalid ed25519 public key');
  return bytesToHex(bytes);
}
export function encodeAction(receiverId: string, action: Action, from: Hex, network: Network): EthereumTransaction {
  accountId(receiverId);
  const p = action.params;
  const to = (/^0x[0-9a-f]{40}$/.test(receiverId) && !['AddKey', 'DeleteKey'].includes(action.type)
    ? receiverId : `0x${keccak256(toHex(receiverId)).slice(-40)}`) as Hex;
  let data: Hex;
  let deposit = 0n;
  switch (action.type) {
    case 'Transfer':
      deposit = amount(p.deposit);
      data = encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [receiverId, Number(deposit % 1_000_000n)] });
      break;
    case 'FunctionCall': {
      deposit = amount(p.deposit);
      const gas = amount(p.gas, MAX_GAS);
      if (!gas || typeof p.methodName !== 'string' || !p.methodName) throw new Error('Function call needs a method and nonzero gas');
      const args = p.args instanceof Uint8Array ? p.args : new TextEncoder().encode(JSON.stringify(p.args ?? {}));
      data = encodeFunctionData({ abi: ABI, functionName: 'functionCall', args: [receiverId, p.methodName, bytesToHex(args), gas, Number(deposit % 1_000_000n)] });
      break;
    }
    case 'AddKey': {
      if (receiverId !== from) throw new Error('Access keys may only be changed on the signing account');
      const permission = p.accessKey.permission;
      if (!permission || permission === 'FullAccess') throw new Error('FullAccess keys are not supported');
      accountId(permission.receiverId);
      const allowance = permission.allowance === undefined ? undefined : amount(permission.allowance);
      const methods = permission.methodNames ?? [];
      if (!Array.isArray(methods) || !methods.every((m: unknown) => typeof m === 'string' && m.length)) throw new Error('Invalid access key methods');
      const nonce = amount(String(p.accessKey.nonce ?? 0), (1n << 64n) - 1n);
      data = encodeFunctionData({ abi: ABI, functionName: 'addKey', args: [0, key(p.publicKey), nonce, false, allowance !== undefined, allowance ?? 0n, permission.receiverId, methods] });
      break;
    }
    case 'DeleteKey':
      if (receiverId !== from) throw new Error('Access keys may only be changed on the signing account');
      data = encodeFunctionData({ abi: ABI, functionName: 'deleteKey', args: [0, key(p.publicKey)] });
      break;
    default: throw new Error(`Unsupported NEP-518 action: ${action.type}`);
  }
  return { from, to, data, value: toHex(deposit / 1_000_000n), chainId: toHex(networkConfig(network).chainId), type: '0x0' };
}
export function encodeTransactions(txs: Transaction[], from: Hex, network: Network) {
  if (!Array.isArray(txs) || !txs.length) throw new Error('No transactions supplied');
  return txs.map(tx => {
    // Splitting changes atomic semantics. Require callers to explicitly use a batch instead.
    if (!Array.isArray(tx.actions) || tx.actions.length !== 1) throw new Error('NEP-518 supports one action per transaction. Submit separate transactions explicitly.');
    return encodeAction(tx.receiverId, tx.actions[0], from, network);
  });
}

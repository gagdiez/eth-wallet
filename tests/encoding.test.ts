import { describe, expect, it } from 'vitest';
import { decodeFunctionData, hexToBytes, keccak256, toHex } from 'viem';
import { base58 } from '@scure/base';
import { ABI, encodeAction, encodeTransactions, MAX_GAS } from '../src/encoding';
const address = '0x1234567890123456789012345678901234567890';
const publicKey = `ed25519:${base58.encode(new Uint8Array(32).fill(1))}`;
const transfer = (deposit: string) => ({ type: 'Transfer', params: { deposit } });

describe('NEP-518 encoding', () => {
  it.each(['1', '999999', '1000000', '1000001', '123456789012345678901234567890'])('preserves every yoctoNEAR in %s', deposit => {
    const tx = encodeAction('alice.testnet', transfer(deposit), address, 'testnet');
    const decoded = decodeFunctionData({ abi: ABI, data: tx.data });
    expect(decoded.functionName).toBe('transfer');
    expect(BigInt(tx.value) * 1_000_000n + BigInt(decoded.args![1])).toBe(BigInt(deposit));
    expect(tx.chainId).toBe('0x18e');
    expect(tx.type).toBe('0x0');
    expect(tx.to).toBe(`0x${keccak256(toHex('alice.testnet')).slice(-40)}`);
  });
  it('uses an Ethereum recipient directly for transfers', () => {
    expect(encodeAction(address, transfer('1'), address, 'mainnet').to).toBe(address);
  });
  it.each(['testnet', 'mainnet'] as const)('encodes JSON arguments and 30 Tgas on %s', network => {
    const tx = encodeAction('guest-book.testnet', { type: 'FunctionCall', params: { methodName: 'addMessage', args: { text: 'hello 🌎' }, deposit: '1', gas: '30000000000000' } }, address, network);
    const decoded = decodeFunctionData({ abi: ABI, data: tx.data });
    expect(decoded.functionName).toBe('functionCall');
    const args = decoded.args!;
    expect(args.slice(0, 2)).toEqual(['guest-book.testnet', 'addMessage']);
    expect(JSON.parse(new TextDecoder().decode(hexToBytes(args[2] as `0x${string}`)))).toEqual({ text: 'hello 🌎' });
    expect(args[3]).toBe(30_000_000_000_000n);
    expect(args[4]).toBe(1);
  });
  it('preserves raw byte arguments', () => {
    const tx = encodeAction('app.testnet', { type: 'FunctionCall', params: { methodName: 'call', args: new Uint8Array([255, 0]), deposit: '0', gas: '1' } }, address, 'testnet');
    expect(decodeFunctionData({ abi: ABI, data: tx.data }).args![2]).toBe('0xff00');
  });
  it('hashes the signer recipient for access keys and restricts the relayer', () => {
    const tx = encodeAction(address, { type: 'AddKey', params: { publicKey, accessKey: { permission: { receiverId: address, methodNames: ['rlp_execute'] } } } }, address, 'testnet');
    expect(tx.to).not.toBe(address);
    expect(decodeFunctionData({ abi: ABI, data: tx.data }).args).toEqual([0, toHex(new Uint8Array(32).fill(1)), 0n, false, false, 0n, address, ['rlp_execute']]);
  });
  it.each(['-1', '1.5', '1e24', '', String(1n << 128n)])('rejects invalid amounts %s', deposit => {
    expect(() => encodeAction('alice.testnet', transfer(deposit), address, 'testnet')).toThrow();
  });
  it('rejects excess gas instead of silently modifying the request', () => {
    expect(() => encodeAction('app.testnet', { type: 'FunctionCall', params: { deposit: '0', gas: String(MAX_GAS + 1n), methodName: 'call' } }, address, 'testnet')).toThrow('limit');
  });
  it('rejects full-access keys and changing another account’s keys', () => {
    expect(() => encodeAction(address, { type: 'AddKey', params: { publicKey, accessKey: { permission: 'FullAccess' } } }, address, 'testnet')).toThrow('FullAccess');
    expect(() => encodeAction('alice.testnet', { type: 'DeleteKey', params: { publicKey } }, address, 'testnet')).toThrow('signing account');
  });
  it('rejects a batch containing unsupported actions before execution', () => {
    expect(() => encodeTransactions([{ receiverId: address, actions: [transfer('1')] }, { receiverId: address, actions: [{ type: 'DeployContract' }] }], address, 'testnet')).toThrow('Unsupported');
  });
  it('rejects implicit splitting of an atomic multi-action transaction', () => {
    expect(() => encodeTransactions([{ receiverId: address, actions: [transfer('1'), transfer('2')] }], address, 'testnet')).toThrow('one action');
  });
});

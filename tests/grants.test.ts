import { describe, expect, it } from 'vitest';
import { OriginGrants } from '../src/grants';
const account = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
function setup() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  return { grants: new OriginGrants(storage), storage };
}
describe('wallet origin grants', () => {
  it('binds approvals to the exact origin, account, and network and persists across instances', () => {
    const { grants, storage } = setup();
    grants.approve('https://app.com', 'mainnet', account);
    expect(() => new OriginGrants(storage).require('https://app.com', 'mainnet', account)).not.toThrow();
    for (const origin of ['https://evil.com', 'http://app.com', 'https://app.com:444', 'https://sub.app.com']) {
      expect(() => grants.require(origin, 'mainnet', account)).toThrow('not connected');
    }
    expect(() => grants.require('https://app.com', 'testnet', account)).toThrow('not connected');
    expect(() => grants.require('https://app.com', 'mainnet', other)).toThrow('not connected');
  });
  it('revokes one site/network without disturbing other grants', () => {
    const { grants } = setup();
    grants.approve('https://a.com', 'mainnet', account);
    grants.approve('https://b.com', 'mainnet', account);
    grants.approve('https://a.com', 'testnet', other);
    grants.revoke('https://a.com', 'mainnet');
    expect(() => grants.require('https://a.com', 'mainnet', account)).toThrow();
    expect(() => grants.require('https://b.com', 'mainnet', account)).not.toThrow();
    expect(() => grants.require('https://a.com', 'testnet', other)).not.toThrow();
  });
});

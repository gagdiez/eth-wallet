import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));

describe('local wallet manifest', () => {
  it('points to the wallet served at the root', () => {
    const wallet = template.wallets[0];
    const popup = new URL(wallet.metadata!.signPageURL);
    expect(popup.origin).toBe('http://localhost:5173');
    expect(popup.pathname).toBe('/');
    expect(wallet.permissions.allowsOpen).toEqual([popup.href]);
    expect(wallet.executor).toBe('http://localhost:5173/executor.js');
    expect(wallet.icon).toBe('http://localhost:5173/ethereum.svg');
    expect(wallet.website).toBe(popup.href);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDemoManifest } from '../example/manifest';

const template = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));

describe('local wallet manifest origins', () => {
  it.each(['http://127.0.0.1:5173', 'http://localhost:5173', 'https://wallet.example'])('resolves wallet resources against the wallet origin %s', origin => {
    const manifest = createDemoManifest(template, origin);
    const wallet = manifest.wallets[0];
    const popup = new URL(wallet.metadata!.signPageURL);
    expect(popup.origin).toBe(origin);
    expect(popup.pathname).toBe('/wallet.html');
    expect(wallet.permissions.allowsOpen).toEqual([popup.href]);
    expect(new URL(wallet.executor).origin).toBe(origin);
    expect(new URL(wallet.icon).origin).toBe(origin);
    expect(new URL(wallet.website!).origin).toBe(origin);
    expect(template.wallets[0].metadata.signPageURL).toBe('http://localhost:5173/wallet.html');
  });
});

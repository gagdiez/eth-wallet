import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestWallet } from '../src/executor';
import { receiveRequest } from '../src/sign-page';
import { CHANNEL } from '../src/types';

const requestId = 'ab'.repeat(32);
const origin = 'http://localhost:5173';
const payload = { kind: 'signIn' as const, network: 'testnet' as const };
let target: EventTarget;
function deliver(data: unknown, source?: unknown, messageOrigin = origin) {
  const event = new Event('message');
  Object.assign(event, { data, source, origin: messageOrigin });
  target.dispatchEvent(event);
}
beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  vi.stubGlobal('window', target);
  vi.stubGlobal('location', { hash: `#${new URLSearchParams({ requestId, origin })}` });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('approval page handshake', () => {
  it('reports onboarding errors without closing the wallet error screen', async () => {
    const popup = { postMessage: vi.fn(), close: vi.fn(), closed: false, windowIdPromise: Promise.resolve('popup') };
    const selector = { location: origin, open: vi.fn((_url: string) => popup) };
    const pending = requestWallet(selector, `${origin}/wallet.html`, payload);
    const rejected = expect(pending).rejects.toThrow('Onboarding failed');
    const url = new URL(selector.open.mock.calls[0][0]);
    const id = new URLSearchParams(url.hash.slice(1)).get('requestId');
    deliver({ channel: CHANNEL, requestId: id, type: 'READY' });
    deliver({ channel: CHANNEL, requestId: id, type: 'ERROR', error: 'Onboarding failed' });
    await rejected;
    expect(popup.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries READY until the opener delivers the request', async () => {
    const opener = { postMessage: vi.fn() };
    Object.assign(target, { opener });
    const pending = receiveRequest([origin]);
    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(opener.postMessage).toHaveBeenCalledTimes(3);
    deliver({ channel: CHANNEL, requestId, type: 'REQUEST', payload }, opener);
    expect((await pending).payload).toEqual(payload);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(opener.postMessage).toHaveBeenCalledTimes(3);
  });
  it('ignores messages from another origin, window, or request', async () => {
    const opener = { postMessage: vi.fn() };
    Object.assign(target, { opener });
    const pending = receiveRequest([origin]);
    const resolved = vi.fn();
    pending.then(resolved);
    const message = { channel: CHANNEL, requestId, type: 'REQUEST', payload };
    deliver(message, {}, origin);
    deliver(message, opener, 'https://untrusted.example');
    deliver({ ...message, requestId: 'bad' }, opener);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    deliver(message, opener);
    const request = await pending;
    request.respond([{ accountId: 'example' }]);
    request.respond([]);
    expect(opener.postMessage.mock.calls.filter(([m]) => m.type === 'RESULT')).toHaveLength(1);
  });
  it('shows an actionable error when the dApp cannot deliver the request', async () => {
    Object.assign(target, { opener: { postMessage: vi.fn() } });
    const pending = receiveRequest([origin]);
    const rejected = expect(pending).rejects.toThrow('choose Ethereum Wallets again');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('resends the request when a refreshed wallet page announces READY again', async () => {
    const popup = { postMessage: vi.fn(), close: vi.fn(), closed: false, windowIdPromise: Promise.resolve('popup') };
    const selector = { location: origin, open: vi.fn((_url: string) => popup) };
    const pending = requestWallet(selector, `${origin}/wallet.html`, payload);
    const url = new URL(selector.open.mock.calls[0][0]);
    const id = new URLSearchParams(url.hash.slice(1)).get('requestId');
    const ready = { channel: CHANNEL, requestId: id, type: 'READY' };
    deliver(ready);
    deliver(ready);
    expect(popup.postMessage).toHaveBeenCalledTimes(2);
    expect(popup.postMessage.mock.calls[0][0]).toEqual(popup.postMessage.mock.calls[1][0]);
    deliver({ channel: CHANNEL, requestId: id, type: 'RESULT', result: [] });
    expect(await pending).toEqual([]);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

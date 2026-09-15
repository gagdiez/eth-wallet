import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from '../src/types';
const mocks = vi.hoisted(() => ({ receive: vi.fn(), choose: vi.fn(), disconnect: vi.fn(), signIn: vi.fn(), connect: vi.fn(), send: vi.fn() }));
vi.mock('../src/sign-page', () => ({ receiveRequest: mocks.receive }));
vi.mock('../src/appkit', () => ({ chooseAppKitWallet: mocks.choose, disconnectAppKitWallet: mocks.disconnect }));
vi.mock('../src/wallet', () => ({ EthereumNearWallet: class {
  signIn = mocks.signIn; connect = mocks.connect; sendTransactions = mocks.send;
} }));
const account = `0x${'1'.repeat(40)}`;
let elements: Map<string, any>;
let data: Map<string, string>;
function element() { return { hidden: false, disabled: false, textContent: '', innerHTML: '', onclick: undefined, classList: { toggle: vi.fn() }, setAttribute: vi.fn(), replaceChildren: vi.fn(), append: vi.fn() }; }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'test-project');
  elements = new Map(); data = new Map();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  vi.stubGlobal('document', { querySelector: get, getElementById: get, createElement: element });
  vi.stubGlobal('location', { origin: 'https://wallet.com' });
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, task: () => Promise<unknown>) => task() } });
  mocks.choose.mockResolvedValue({}); mocks.disconnect.mockResolvedValue(undefined); mocks.signIn.mockResolvedValue(account); mocks.connect.mockResolvedValue(account); mocks.send.mockResolvedValue(['outcome']);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function open(payload: Request, origin = 'https://a.com') {
  const request = { payload, origin, respond: vi.fn(), fail: vi.fn() };
  mocks.receive.mockResolvedValue(request);
  await import('../wallet/wallet-page');
  await vi.waitFor(() => expect(elements.get('approve')?.disabled).toBeDefined());
  return request;
}
const transaction: Request = { kind: 'signAndSendTransaction', network: 'testnet', signerId: account, receiverId: 'alice.testnet', actions: [{ type: 'Transfer', params: { deposit: '1' } }] };
describe('wallet page authorization', () => {
  it('does not use AppKit or grant access until the user clicks Connect', async () => {
    const request = await open({ kind: 'signIn', network: 'testnet' });
    expect(mocks.choose).not.toHaveBeenCalled(); expect(data.size).toBe(0);
    elements.get('approve').onclick();
    await vi.waitFor(() => expect(request.respond).toHaveBeenCalledWith([{ accountId: account }]));
    const { OriginGrants } = await import('../src/grants');
    expect(() => new OriginGrants(localStorage).require('https://a.com', 'testnet', account)).not.toThrow();
    expect(mocks.choose).toHaveBeenCalledWith('testnet', 'test-project', { reuseConnection: false });
  });
  it('does not grant access after failed onboarding', async () => {
    mocks.signIn.mockRejectedValue(new Error('Setup failed'));
    const request = await open({ kind: 'signIn', network: 'testnet' });
    elements.get('approve').onclick();
    await vi.waitFor(() => expect(request.fail).toHaveBeenCalled());
    expect(data.size).toBe(0); expect(request.respond).not.toHaveBeenCalled();
  });
  it('rejects another origin even when the account is already authorized elsewhere', async () => {
    const { OriginGrants } = await import('../src/grants');
    new OriginGrants(localStorage).approve('https://a.com', 'testnet', account);
    const request = await open(transaction, 'https://evil.com');
    expect(request.fail).toHaveBeenCalled(); expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled(); expect(elements.get('approve').disabled).toBe(true);
  });
  it('keeps signer checks for authorized sites', async () => {
    const { OriginGrants } = await import('../src/grants');
    new OriginGrants(localStorage).approve('https://a.com', 'testnet', account);
    mocks.connect.mockResolvedValue(`0x${'2'.repeat(40)}`);
    await open(transaction);
    elements.get('approve').onclick();
    await vi.waitFor(() => expect(elements.get('status').textContent).toContain('differs'));
    expect(mocks.choose).toHaveBeenCalledWith('testnet', 'test-project', { reuseConnection: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('disconnects AppKit and revokes only the requesting site', async () => {
    const { OriginGrants } = await import('../src/grants');
    const grants = new OriginGrants(localStorage);
    grants.approve('https://a.com', 'testnet', account); grants.approve('https://b.com', 'testnet', account);
    const request = await open({ kind: 'signOut', network: 'testnet' });
    await vi.waitFor(() => expect(request.respond).toHaveBeenCalled());
    expect(() => grants.require('https://a.com', 'testnet', account)).toThrow();
    expect(() => grants.require('https://b.com', 'testnet', account)).not.toThrow();
    expect(mocks.disconnect).toHaveBeenCalledWith('testnet', 'test-project');
    expect(mocks.choose).not.toHaveBeenCalled();
  });
});

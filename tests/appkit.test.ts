import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const handlers = { account: undefined as undefined | (() => void), providers: undefined as undefined | (() => void), state: undefined as undefined | ((state: { open: boolean }) => void) };
  const cleanup = vi.fn();
  const picker = {
    ready: vi.fn(async () => {}), close: vi.fn(async () => {}), open: vi.fn(async () => { handlers.state?.({ open: true }); }),
    disconnect: vi.fn(async (_namespace: string) => {}),
    getAccount: vi.fn<() => undefined | { isConnected: boolean }>(() => undefined),
    getProvider: vi.fn<() => unknown>(() => undefined),
    subscribeAccount: vi.fn((callback: () => void) => { handlers.account = callback; return cleanup; }),
    subscribeProviders: vi.fn((callback: () => void) => { handlers.providers = callback; return cleanup; }),
    subscribeState: vi.fn((callback: (state: { open: boolean }) => void) => { handlers.state = callback; return cleanup; }),
  };
  return { handlers, cleanup, picker, create: vi.fn(() => picker) };
});
vi.mock('@reown/appkit', () => ({ createAppKit: mock.create }));
vi.mock('@reown/appkit-adapter-ethers', () => ({ EthersAdapter: class {} }));
vi.mock('@reown/appkit/networks', () => ({ defineChain: (chain: unknown) => chain }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.picker.getAccount.mockReturnValue(undefined);
  mock.picker.getProvider.mockReturnValue(undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:5173' });
});

describe('AppKit handoff', () => {
  it('opens a fresh selection on explicit sign-in instead of returning the previous wallet', async () => {
    const previousProvider = { request: vi.fn() };
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.picker.getProvider.mockReturnValue(previousProvider);
    mock.picker.disconnect.mockImplementationOnce(async () => {
      mock.picker.getAccount.mockReturnValue({ isConnected: false });
      mock.picker.getProvider.mockReturnValue(undefined);
    });
    const { chooseAppKitWallet } = await import('../src/appkit');
    const pending = chooseAppKitWallet('testnet', 'project-id', { reuseConnection: false });
    const completed = vi.fn(); pending.then(completed);
    await vi.waitFor(() => expect(mock.picker.open).toHaveBeenCalled());
    expect(completed).not.toHaveBeenCalled();
    expect(mock.picker.disconnect).toHaveBeenCalledWith('eip155');
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ enableReconnect: false }));
    const newProvider = { request: vi.fn() };
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.picker.getProvider.mockReturnValue(newProvider);
    mock.handlers.account?.();
    expect(await pending).toBe(newProvider);
  });
  it('waits for session restoration on a fresh page and skips the picker', async () => {
    let restored!: () => void;
    mock.picker.ready.mockImplementationOnce(() => new Promise<void>(resolve => { restored = resolve; }));
    const { chooseAppKitWallet } = await import('../src/appkit');
    const pending = chooseAppKitWallet('testnet', 'project-id');
    await Promise.resolve();
    expect(mock.picker.open).not.toHaveBeenCalled();
    const provider = { request: vi.fn() };
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.picker.getProvider.mockReturnValue(provider);
    restored();
    expect(await pending).toBe(provider);
    expect(mock.picker.open).not.toHaveBeenCalled();
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ enableReconnect: true }));
    expect(mock.picker.disconnect).not.toHaveBeenCalled();
  });
  it('waits for both the connected account and its provider', async () => {
    const { chooseAppKitWallet } = await import('../src/appkit');
    const pending = chooseAppKitWallet('testnet', 'project-id');
    const completed = vi.fn(); pending.then(completed);
    await vi.waitFor(() => expect(mock.picker.open).toHaveBeenCalled());
    const provider = { request: vi.fn() };
    mock.picker.getProvider.mockReturnValue(provider);
    mock.handlers.providers?.();
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.handlers.account?.();
    expect(await pending).toBe(provider);
    expect(mock.cleanup).toHaveBeenCalledTimes(3);
    expect(mock.picker.close).toHaveBeenCalledOnce();
  });
  it('lets users dismiss and reopen the picker without leaving a pending request', async () => {
    const { chooseAppKitWallet } = await import('../src/appkit');
    const first = chooseAppKitWallet('testnet', 'project-id');
    const rejected = expect(first).rejects.toThrow('Wallet selection cancelled');
    await vi.waitFor(() => expect(mock.picker.open).toHaveBeenCalled());
    mock.handlers.state?.({ open: false });
    await rejected;
    const second = chooseAppKitWallet('testnet', 'project-id');
    await vi.waitFor(() => expect(mock.picker.open).toHaveBeenCalledTimes(2));
    const provider = { request: vi.fn() };
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.picker.getProvider.mockReturnValue(provider);
    mock.handlers.providers?.();
    expect(await second).toBe(provider);
    expect(mock.create).toHaveBeenCalledTimes(1);
  });
  it('configures native NEAR and EOA wallets without unrelated login methods', async () => {
    const { chooseAppKitWallet } = await import('../src/appkit');
    const provider = { request: vi.fn() };
    mock.picker.getAccount.mockReturnValue({ isConnected: true });
    mock.picker.getProvider.mockReturnValue(provider);
    expect(await chooseAppKitWallet('testnet', 'project-id')).toBe(provider);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-id',
      networks: [expect.objectContaining({ id: 398, rpcUrls: { default: { http: ['https://eth-rpc.testnet.near.org'] } } })],
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
      defaultAccountTypes: { eip155: 'eoa' },
    }));
  });
});

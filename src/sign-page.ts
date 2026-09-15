import { errorMessage } from './errors';
import { CHANNEL, type Request } from './types';
import { networkConfig } from './networks';

export function receiveRequest(): Promise<{ payload: Request; origin: string; respond: (result: unknown) => void; fail: (error: unknown) => void }> {
  const params = new URLSearchParams(location.hash.slice(1));
  const requestId = params.get('requestId');
  const origin = params.get('origin');
  try {
    const url = new URL(origin ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
  } catch { return Promise.reject(new Error('Open the wallet through your dApp')); }
  if (!window.opener) return Promise.reject(new Error('This wallet tab is not connected to a dApp'));
  if (!requestId || !/^[a-f0-9]{64}$/.test(requestId)) return Promise.reject(new Error('The wallet URL is missing a valid request ID'));
  return new Promise((resolve, reject) => {
    const opener = window.opener;
    const post = (body: object) => opener.postMessage({ channel: CHANNEL, requestId, ...body }, origin);
    let replied = false;
    const finish = (body: object) => { if (!replied) { replied = true; post(body); } };
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== opener || event.origin !== origin || message?.channel !== CHANNEL || message?.requestId !== requestId || message?.type !== 'REQUEST') return;
      clearTimeout(timeout);
      clearInterval(readyRetry);
      window.removeEventListener('message', handler);
      try {
        const payload = { ...message.payload, network: message.payload?.network ?? 'testnet' } as Request;
        networkConfig(payload.network);
        if (!['signIn', 'signOut', 'signAndSendTransaction', 'signAndSendTransactions'].includes(payload.kind)) throw new Error('Unsupported request');
        if (payload.addFunctionCallKey) throw new Error('Sign-in access keys are not supported');
        // Use the browser-authenticated sender, never an origin claimed in the payload.
        resolve({ payload, origin: event.origin,
          respond: result => finish({ type: 'RESULT', result }),
          fail: error => finish({ type: 'ERROR', error: errorMessage(error) }),
        });
      } catch (error) { finish({ type: 'ERROR', error: errorMessage(error) }); reject(error); }
    };
    const timeout = setTimeout(() => {
      clearInterval(readyRetry);
      window.removeEventListener('message', handler);
      reject(new Error('The dApp did not send a request'));
    }, 30_000);
    window.addEventListener('message', handler);
    // The opener's forwarding listener may not yet be ready when this page loads.
    const readyRetry = setInterval(() => post({ type: 'READY' }), 500);
    post({ type: 'READY' });
  });
}

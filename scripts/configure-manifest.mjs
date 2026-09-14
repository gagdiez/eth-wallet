import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = new URL('../dist/manifest.json', import.meta.url);
const baseUrl = new URL(process.env.WALLET_BASE_URL || 'http://localhost:5173');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const wallet = manifest.wallets.find(({ id }) => id === 'ethereum-wallets');

if (!wallet) throw new Error('The ethereum-wallets entry is missing from dist/manifest.json');

const resource = path => new URL(path, `${baseUrl.href.replace(/\/$/, '')}/`).href;
const walletUrl = resource('');

wallet.icon = resource('ethereum.svg');
wallet.website = walletUrl;
wallet.executor = resource('executor.js');
wallet.permissions = { ...wallet.permissions, allowsOpen: [walletUrl] };
wallet.metadata = { ...wallet.metadata, signPageURL: walletUrl };

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

# Ethereum Wallets for near-connect

A `wallet` module for `near-connect`, that uses **Reown AppKit** and NEP-518 to
enable Ethereum wallets to sign transactions on NEAR. It is a drop-in replacement
for the old wallet-selector EVM integration, and it can be used in any dApp that
uses `near-connect`.

## Run the wallet

```sh
npm install
# Set VITE_WALLETCONNECT_PROJECT_ID in .env.local (see .env.example).
npm run dev
```

The wallet, its “How it works” explainer, and the manifest are served at
`http://localhost:5173/`, `http://localhost:5173/how-it-works/`, and
`http://localhost:5173/manifest.json`.

## Standalone example

`example/` is a separate dApp with its own dependencies, configuration, and
build. It consumes the wallet exclusively through `VITE_WALLET_MANIFEST_URL`;
the wallet source and local manifest template are not imported.

See [`example/README.md`](example/README.md) for its setup instructions.

## Structure

- `src/appkit.ts`: AppKit configuration and EIP-1193 provider handoff; ethers is its adapter, while the transaction engine uses the provider directly.
- `src/encoding.ts`: NEAR actions → NEP-518 Ethereum calldata, preserving yoctoNEAR precision.
- `src/wallet.ts`: chain/account checks, relayer onboarding, submissions, and final NEAR outcomes.
- `src/executor.ts` and `src/sign-page.ts`: near-connect sandbox/popup messaging.
- `public/manifest.json`: wallet manifest template for external dApps.
- `wallet/`: wallet approval screen and the standalone “How it works” page.
- `example/`: removable standalone dApp that installs and builds independently and consumes the hosted manifest.
- `vite.config.ts`: wallet-only server and build configuration.

## Deploy to GitHub Pages

The `Deploy wallet to GitHub Pages` workflow publishes the contents of `dist/`
on every push to `main`. The artifact contains the wallet and its
`manifest.json`; the example dApp is not built or deployed.

Before the first deployment, configure the repository as follows:

1. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as
   the source.
2. Add an Actions secret named `VITE_WALLETCONNECT_PROJECT_ID` containing the
   Reown project ID.

The published manifest is available at the Pages site URL plus
`/manifest.json`, and the wallet itself is served at the Pages site root. During
the Pages build, the manifest's wallet resource URLs are rewritten to the Pages
URL. The development server uses the same root layout on port 5173.

## Account onboarding

Login uses the old module's `alwaysOnboardDuringSignIn` flow: fetch `near_getPublicKey`, query the account's relayer access key, and submit the NEP-518 `addKey` operation only for `UNKNOWN_ACCOUNT` or `UNKNOWN_ACCESS_KEY` (including legacy missing-account errors). The relayer recognizes this self-directed operation, with gas price 1 wei, and sponsors account/key onboarding. The key has function-call permission for `rlp_execute` on the user's own account; it is not a full-access key. Existing onboarded accounts need no onboarding transaction. RPC failures and rejected/failed onboarding do not produce a successful login. Account setup does not provide a spendable balance for subsequent dApp transactions.

## Supported scope

Connections require explicit approval on the wallet page. Grants are stored on the wallet origin for each dApp origin, account, and network; transactions require a matching grant and still require signing approval. Existing connections must reconnect once to create a grant. Disconnect opens the wallet briefly, disconnects the shared AppKit provider session, and revokes that site's grant on the selected network. Other sites' grants are left intact. If that popup is blocked, disconnect fails rather than claiming the grant was revoked.

Every operation requires a verified opener/message origin and request token; directly opening the wallet URL cannot connect, sign, or revoke grants. Any HTTP(S) dApp may request a connection, but it cannot impersonate another origin. Wallet popups coordinate through Web Locks (required) to serialize provider use and revocation. Clearing wallet-site storage removes grants. Different providers per dApp are not tracked.

Mainnet and testnet are enabled. Supports transfers, function calls, and ed25519 function-call key changes. One action per transaction; batches run sequentially and may partially complete.

The adapter caps gas at 270 Tgas to leave wrapper headroom below the relayer’s 300 Tgas ceiling. The example attaches 30 Tgas to contract calls. Full-access keys, delegated actions, NEP-413 signing, and sign-in access keys are unsupported. Transactions use native NEAR balances through the Ethereum relayer. Mainnet live testing is pending.

## Checks

```sh
npm test
npm run build
```

Unit tests cover encoding, onboarding, receipt failures, account changes, partial completion, popup handshake recovery, manifest URLs, and AppKit connection/cancellation. These mocked tests do not replace live MetaMask/WalletConnect transaction verification.

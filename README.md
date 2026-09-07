# Ethereum Wallets for near-connect

A `wallet` module for `near-connect`, that uses **Reown AppKit** and NEP-518 to enable Ethereum wallets to sign transactions on NEAR. It is a drop-in replacement for the old wallet-selector EVM integration, and it can be used in any dApp that uses `near-connect`.

## Run the demo

```sh
npm install
# Set VITE_WALLETCONNECT_PROJECT_ID in .env.local (see .env.example).
npm run dev
```

Open the demo at `http://127.0.0.1:5174`. This command starts both the demo and the wallet on port **5173**; Ctrl+C stops both. The demo also works on `localhost`; its local manifest points to the wallet server using the same hostname. Restart after changing environment variables.

To test mainnet, add this to `example/.env.local` and restart `npm run dev`:

```dotenv
VITE_NEAR_NETWORK=mainnet
```

The default is `testnet`. This selects the connector network, FastNEAR RPC, explorer links, and demo labels. On mainnet, enter your own contract and method; the guest-book preset is testnet-only. The wallet's Reown settings remain in the root `.env.local`.

## Structure

- `src/appkit.ts`: AppKit configuration and EIP-1193 provider handoff; ethers is its adapter, while the transaction engine uses the provider directly.
- `src/encoding.ts`: NEAR actions → NEP-518 Ethereum calldata, preserving yoctoNEAR precision.
- `src/wallet.ts`: chain/account checks, relayer onboarding, submissions, and final NEAR outcomes.
- `src/executor.ts` and `src/sign-page.ts`: near-connect sandbox/popup messaging.
- `public/manifest.json`: wallet manifest template for external dApps.
- `wallet/`: wallet HTML entry point, approval screen, and styles.
- `example/`: independent demo dApp with its own HTML entry point and Vite configuration. It uses the wallet's HTTP manifest and near-connect; it does not import wallet implementation code.
- `vite.config.ts`: wallet-only server and build configuration.

## Account onboarding

Login uses the old module's `alwaysOnboardDuringSignIn` flow: fetch `near_getPublicKey`, query the account's relayer access key, and submit the NEP-518 `addKey` operation only for `UNKNOWN_ACCOUNT` or `UNKNOWN_ACCESS_KEY` (including legacy missing-account errors). The relayer recognizes this self-directed operation, with gas price 1 wei, and sponsors account/key onboarding. The key has function-call permission for `rlp_execute` on the user's own account; it is not a full-access key. Existing onboarded accounts need no onboarding transaction. RPC failures and rejected/failed onboarding do not produce a successful login. Account setup does not provide a spendable balance for subsequent dApp transactions.

## Supported scope

Mainnet and testnet are enabled. Supports transfers, function calls, and ed25519 function-call key changes. One action per transaction; batches run sequentially and may partially complete.

The adapter caps gas at 270 Tgas to leave wrapper headroom below the relayer’s 300 Tgas ceiling. The example attaches 30 Tgas to contract calls. Full-access keys, delegated actions, NEP-413 signing, and sign-in access keys are unsupported. Transactions use native NEAR balances through the Ethereum relayer. Mainnet live testing is pending.

## Checks

```sh
npm test
npm run build
npm run build:example
```

Unit tests cover encoding, onboarding, receipt failures, account changes, partial completion, popup handshake recovery, demo origins, and AppKit connection/cancellation. These mocked tests do not replace live MetaMask/WalletConnect transaction verification.

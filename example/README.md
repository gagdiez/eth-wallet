# Ethereum wallet example

This is a standalone near-connect dApp. It loads near-connect's default wallets,
then adds Ethereum Wallets through its published manifest without importing files
from the wallet repository.

```sh
cp .env.example .env.local
npm install
npm run dev
```

The example adds the wallet hosted at
`https://evm-on-near.dev/`, whose manifest is available at
`https://evm-on-near.dev/manifest.json`, to the default near-connect wallet list.

The directory can be copied into a separate repository and developed, built,
and deployed independently.

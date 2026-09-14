# Ethereum wallet example

This is a standalone near-connect dApp. It consumes the Ethereum wallet through
its published manifest and does not import files from the wallet repository.

```sh
cp .env.example .env.local
npm install
npm run dev
```

Set `VITE_WALLET_MANIFEST_URL` to the deployed wallet manifest. The wallet must
also allow this app's origin through its `VITE_ALLOWED_ORIGINS` configuration.

The directory can be copied into a separate repository and developed, built,
and deployed independently.

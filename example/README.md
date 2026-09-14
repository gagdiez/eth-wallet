# Ethereum wallet example

This is a standalone near-connect dApp. It consumes the Ethereum wallet through
its published manifest and does not import files from the wallet repository.

```sh
cp .env.example .env.local
npm install
npm run dev
```

The example configuration uses the wallet hosted at
`https://evm-on-near.dev/`, whose manifest is available at
`https://evm-on-near.dev/manifest.json`.

The directory can be copied into a separate repository and developed, built,
and deployed independently.

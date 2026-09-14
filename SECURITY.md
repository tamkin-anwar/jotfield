# Security

Please report a suspected Jotfield security issue privately to the repository owner. Do not open a public issue containing account details, note contents, encryption keys, recovery material, or steps that expose another person’s data.

## Current product boundary

The published app stores the working notebook locally in the browser. Encrypted backups and private note links use browser cryptography. Production cloud accounts add end-to-end encrypted synchronization while keeping readable note content off the server.

## Repository secrets

Only the Supabase project URL and publishable browser key may use `VITE_` environment names. Never commit a service-role key, database password, recovery key, private device key, or user secret. Server-only credentials belong in the hosting provider’s secret store.

## Supported releases

Security fixes are applied to the current version on the `main` branch.

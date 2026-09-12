# Jotfield production architecture

Jotfield remains a local-first notebook. Opening the app, writing, searching, exporting, and recovering notes never require an account.

## Application boundary

The browser owns the working copy in IndexedDB. Cloud synchronization is an optional layer that observes committed local changes and exchanges encrypted operations. The interface does not wait for the network before confirming an edit.

The production build uses Vite so dependencies, environment configuration, source maps, and deployment output are deterministic. Cloud configuration is read from build-time public environment values. A Supabase service-role key must never appear in this repository or in browser code.

## Security boundary

Authentication and note encryption are separate systems. Supabase Auth proves who is signed in. Jotfield will encrypt note content before it leaves the browser.

The database stores ciphertext, nonces, encrypted operations, wrapped workspace keys, membership, and version metadata. Row Level Security provides a second authorization boundary for every table. Private Realtime channels will use the same membership rules.

Future encryption work must include:

1. A random AES-256-GCM content key for every note.
2. A versioned workspace key that wraps note keys.
3. A public key for every trusted device.
4. A separately stored recovery key that Jotfield cannot reconstruct.
5. Key rotation when a device or workspace member is removed.
6. Local search indexes derived only after decryption.

## Synchronization contract

Every local change receives a protocol version, unique operation ID, kind, client timestamp, and payload. Operation IDs make retries safe. Server timestamps establish an ordered retrieval cursor. Note content versions prevent silent overwrites.

The current BroadcastChannel tab synchronization now uses the same envelope shape planned for cloud synchronization. This lets the cloud transport arrive without changing how the editor describes committed changes.

## Deployment environments

Development, preview, and production use separate Supabase projects. Preview deployments must never use the production database. Schema changes are versioned in `supabase/migrations` and reviewed before application.

GitHub Actions checks the JavaScript, creates the production bundle, and publishes the `dist` directory to GitHub Pages. A later backend deployment can move the frontend without changing its relative asset paths.

# Jotfield production architecture

Jotfield remains a local-first notebook. Opening the app, writing, searching, exporting, and recovering notes never require an account.

## Application boundary

The browser owns the working copy in IndexedDB. Notes, spaces, tasks, revisions, and notebook metadata use separate records so a small edit does not clone and rewrite the complete notebook. Version 3 migrates the earlier whole-notebook record automatically and retains the browser backup while the new records are established. Storage failures remain visible in the save indicator and direct the owner to download an encrypted backup.

Cloud synchronization is an optional layer that observes committed local changes and exchanges encrypted operations. The interface does not wait for the network before confirming an edit.

The production build uses Vite so dependencies, environment configuration, source maps, and deployment output are deterministic. Cloud configuration is read from build-time public environment values. A Supabase service-role key must never appear in this repository or in browser code.

## Security boundary

Authentication and note encryption are separate systems. Supabase Auth proves who is signed in. Jotfield encrypts note content before it leaves the browser.

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

## Structured editor

The note body uses a ProseMirror schema instead of browser editing commands. The schema permits paragraphs, headings, quotes, code blocks, ordered and bulleted lists, interactive checklists, links, images, files, underline, strikethrough, bold, italic, and inline code. Every transaction serializes to semantic HTML for faithful editing and plain text for search, previews, exports, tags, and links.

The editor owns undo and redo history, keyboard behavior, paste parsing, and formatting state. This avoids the inconsistent behavior of deprecated browser commands and provides a stable base for future revisions and collaborative editing. Existing note HTML is parsed through the schema whenever a note first opens. Unsupported pasted markup is discarded while supported structure and text remain.

The writing layer also supports schema-native tables through ProseMirror table transactions. Find and replace operates on model positions rather than changing rendered DOM. Selection and image toolbars follow editor transactions and remain outside stored note content. Printing uses a note-only stylesheet, so interface chrome is excluded from paper and PDF output.

## Private link boundary

Offline snapshot links keep both the encrypted note and its random AES-256-GCM key in the URL fragment. Live links store the ciphertext, nonce, expiration, and owner identity in Supabase. Their random decryption key remains after the `#` in the link, so it is handled by the browser and is not included in the page request.

Live links expire after 1, 7, or 30 days. Their owner can refresh the encrypted copy without changing the link or turn the link off immediately. Anonymous visitors can read only one active encrypted row through a narrow database function. Direct anonymous table access remains revoked.

Live links are read-only. Account collaboration will use separate local workspace stores and per-member wrapped keys so a guest notebook can never merge into an owner's personal workspace.

## Deployment environments

Development, preview, and production use separate Supabase projects. Preview deployments must never use the production database. Schema changes are versioned in `supabase/migrations` and reviewed before application.

GitHub Actions checks the JavaScript, creates the production bundle, and publishes the `dist` directory to GitHub Pages. A later backend deployment can move the frontend without changing its relative asset paths.

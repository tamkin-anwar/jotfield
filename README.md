# Jotfield

Jotfield is a local-first notebook for people who collect ideas faster than they can organize them. It opens directly into your notes, keeps capture immediate, and lets structure emerge through spaces, tags, daily pages, and visible connections.

The interface is built as a luminous desktop instrument. A WebGL light field moves beneath glass surfaces, every icon is drawn as SVG, and the layout scales cleanly from compact screens to 4K displays.

## What is here

- Instant note capture with `Command N`
- A brief, optional first-run guide with direct paths to writing and importing
- Quick Jot capture with `Shift Command N`
- Full notebook search and navigation with `Command K`
- Relevance-ranked search with title, tag, recent, and attachment filters
- Highlighted matches with space and edit-time context
- Spaces for broad areas and inline hashtags for lightweight structure
- Smart Fields for loose thoughts, open tasks, and attachments
- Daily notes through a seven-day date strip
- A task planner with agenda and month views
- Natural date recognition for today, tomorrow, weekdays, times, and repeat schedules
- Local reminders with optional browser notifications while Jotfield is open
- Password-protected encrypted backups that restore by safely merging notes
- AES-256-GCM encryption with a passphrase-derived local key
- Instant conflict-aware updates between open Jotfield tabs
- Installable standalone experience and a purpose-built mobile dock
- Encrypted read-only links for sharing a single note without an account
- Revocable live note links with 1-day, 7-day, or 30-day expiration
- Native device sharing with a copy-link fallback
- Clean shared-note reading view and Markdown downloads
- Multi-file imports for Markdown, plain text, and HTML
- A copyable browser clipper for page titles, addresses, and selected text
- Installed-app sharing that can receive text and links from other apps
- Standards-based iCalendar export for scheduled and recurring tasks
- Daily, weekly, and monthly recurring tasks that advance when completed
- Favorites, archive, recently deleted, restore, and permanent deletion
- Connections and backlinks using `[[Note title]]`
- Related-note context through links and shared tags
- A visual constellation for navigating connected thoughts
- List and card views
- Focus mode for uninterrupted writing
- Rich writing with headings, lists, checklists, quotes, code blocks, links, and attachments
- A structured writing editor with bold, italic, underline, strikethrough, headings, numbered and bulleted lists, checklists, quotes, code blocks, links, attachments, and clear formatting
- Familiar keyboard shortcuts, Markdown input shortcuts, active formatting states, and dependable document undo history
- Document find and replace with case matching and keyboard access
- Structured tables with row, column, header, merge, split, highlight, and deletion controls
- Contextual formatting for selected text and responsive image sizing and alignment
- Note-only print layouts for paper or browser PDF export
- Native browser undo and redo
- Automatic local saving in normalized IndexedDB records with no account or server
- Visible recovery guidance if durable browser storage fails or fills up
- Revision snapshots and offline launch support
- Complete JSON backup and restore
- A GPU-rendered ambient light field with reduced-motion support
- Responsive layouts for desktop, tablet, and mobile
- Account interface for verified email signup, password sign-in, magic links, recovery, session control, and secure cloud account deletion
- Automatic private cloud sync across every trusted device
- End-to-end encryption with a private sync password that never leaves the device
- Live updates across signed-in devices with offline retry and foreground refresh

## Product research

Jotfield combines the interaction patterns people return to across established note tools:

- Apple Notes inspired fast capture, familiar folders, tags, and filtered views.
- Google Keep inspired low-friction organization, color cues, pins, and checklist-friendly writing.
- Evernote inspired reliable search, archive depth, and ownership through export.
- Notion inspired pages that can carry structure without forcing it on every thought.
- Obsidian inspired explicit links and backlinks between notes.
- Fantastical inspired context-first navigation, polished keyboard control, and an interface that feels like one instrument.

Jotfield keeps these ideas inside a focused notebook. Local use does not require AI, a subscription, or a cloud account. Encrypted backup files provide an independent copy without sending the password or readable notes to a server. Restoring merges the backup with the current notebook and keeps the newer version of matching notes. Snapshot links carry the encrypted note in the URL. Signed-in members can also make a live link that stores only ciphertext on the server and keeps its decryption key in the browser-only URL fragment.

## Running locally

Install the project packages once, then start the development server.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Your notes stay in the browser storage for that address. Use the export button in the top bar to create a portable backup.

## Production foundation

The production build uses Vite and creates a deployable `dist` directory. GitHub Actions checks and publishes that bundle after changes reach `main`.

An optional Supabase client boundary is ready for the account batch. Without cloud configuration, Jotfield remains entirely local. The first database migration defines encrypted note records, workspace membership, trusted devices, wrapped keys, synchronization operations, and Row Level Security policies. It does not store readable note content.

See [the production architecture](docs/architecture.md) for the security and synchronization boundaries.

The account interface activates only in a configured cloud build. See [account deployment](docs/account-deployment.md) for the production requirements. Keeping it inactive until the backend policies and mail delivery are configured prevents a misleading or insecure signup experience.

## Technical shape

Jotfield uses semantic HTML, modern CSS, JavaScript modules, ProseMirror, WebGL, IndexedDB, Supabase, a service worker, and a reusable SVG icon system. The editor stores portable semantic HTML alongside searchable plain text. Existing notes are parsed into the structured document model when opened, so the upgrade does not require a destructive content migration.

Built by Anwar Creative Studio.

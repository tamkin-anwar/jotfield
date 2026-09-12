# Jotfield

Jotfield is a local-first notebook for people who collect ideas faster than they can organize them. It opens directly into your notes, keeps capture immediate, and lets structure emerge through spaces, tags, daily pages, and visible connections.

The interface is built as a luminous desktop instrument. A WebGL light field moves beneath glass surfaces, every icon is drawn as SVG, and the layout scales cleanly from compact screens to 4K displays.

## What is here

- Instant note capture with `Command N`
- Full notebook search and navigation with `Command K`
- Relevance-ranked search with title, tag, recent, and attachment filters
- Highlighted matches with space and edit-time context
- Spaces for broad areas and inline hashtags for lightweight structure
- Smart Fields for loose thoughts, open tasks, and attachments
- Daily notes through a seven-day date strip
- Favorites, archive, recently deleted, restore, and permanent deletion
- Connections and backlinks using `[[Note title]]`
- Related-note context through links and shared tags
- A visual constellation for navigating connected thoughts
- List and card views
- Focus mode for uninterrupted writing
- Rich writing with headings, lists, checklists, quotes, code blocks, links, and attachments
- Slash commands and a compact formatting toolbar
- Native browser undo and redo
- Automatic local saving in IndexedDB with no account or server
- Revision snapshots and offline launch support
- Complete JSON backup and restore
- A GPU-rendered ambient light field with reduced-motion support
- Responsive layouts for desktop, tablet, and mobile

## Product research

Jotfield combines the interaction patterns people return to across established note tools:

- Apple Notes inspired fast capture, familiar folders, tags, and filtered views.
- Google Keep inspired low-friction organization, color cues, pins, and checklist-friendly writing.
- Evernote inspired reliable search, archive depth, and ownership through export.
- Notion inspired pages that can carry structure without forcing it on every thought.
- Obsidian inspired explicit links and backlinks between notes.
- Fantastical inspired context-first navigation, polished keyboard control, and an interface that feels like one instrument.

Jotfield keeps these ideas inside a focused personal notebook. It does not require AI, a subscription, or a cloud account.

## Running locally

You need Python 3, which is included with the standard developer tools on macOS.

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Your notes stay in the browser storage for that address. Use the export button in the top bar to create a portable backup.

## Technical shape

Jotfield uses semantic HTML, modern CSS, native JavaScript, WebGL, IndexedDB, a service worker, and a reusable SVG icon system. There are no runtime packages and no build step.

Built by Anwar Creative Studio.

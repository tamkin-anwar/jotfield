# Facet

Facet is a local-first notebook for people who collect ideas faster than they can organize them. It opens directly into your notes, keeps capture immediate, and lets structure emerge through spaces, tags, daily pages, and visible connections.

The interface is built as a luminous desktop instrument. A WebGL light field moves beneath glass surfaces, every icon is drawn as SVG, and the layout scales cleanly from compact screens to 4K displays.

## What is here

- Instant note capture with `Command N`
- Full notebook search and navigation with `Command K`
- Spaces for broad areas and inline hashtags for lightweight structure
- Daily notes through a seven-day date strip
- Favorites, archive, recently deleted, restore, and permanent deletion
- Connections and backlinks using `[[Note title]]`
- List and card views
- Focus mode for uninterrupted writing
- Automatic local saving with no account or server
- Complete JSON backup and restore
- A GPU-rendered ambient light field with reduced-motion support
- Responsive layouts for desktop, tablet, and mobile

## Product research

Facet combines the interaction patterns people return to across established note tools:

- Apple Notes inspired fast capture, familiar folders, tags, and filtered views.
- Google Keep inspired low-friction organization, color cues, pins, and checklist-friendly writing.
- Evernote inspired reliable search, archive depth, and ownership through export.
- Notion inspired pages that can carry structure without forcing it on every thought.
- Obsidian inspired explicit links and backlinks between notes.
- Fantastical inspired context-first navigation, polished keyboard control, and an interface that feels like one instrument.

Facet keeps these ideas inside a focused personal notebook. It does not require AI, a subscription, or a cloud account.

## Running locally

You need Python 3, which is included with the standard developer tools on macOS.

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Your notes stay in the browser storage for that address. Use the export button in the top bar to create a portable backup.

## Technical shape

Facet uses semantic HTML, modern CSS, native JavaScript, WebGL, localStorage, and a reusable SVG icon system. There are no runtime packages and no build step.

Built by Anwar Creative Studio.

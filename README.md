# Todo List App

A clean, modern, fully-featured todo list built with vanilla HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies. Installable as a PWA.

## Features

### Core
- ✅ Add, complete, edit, and delete tasks
- ✅ Persistent storage via `localStorage`
- ✅ Fully responsive (mobile + desktop)
- ✅ PWA — installable, works offline

### Organization
- 📋 **Multiple lists** — sidebar with separate projects (Work, Personal, etc.)
- 🔍 **Filters** — All / Active / Completed with live counts
- 🔎 **Search** — real-time fuzzy search across text and tags
- ↕️ **Sort** — manual (drag), due date, priority, or created date
- 🏷️ **Tags** — hashtag-style categorization
- ☑️ **Bulk select** — shift-click for batch complete/delete

### Task Features
- ✏️ **Inline editing** — double-click to rename
- 📝 **Subtasks** — nested checklists with progress indicator
- 📅 **Due dates** with overdue highlighting
- 🧠 **Smart date parsing** — type "tomorrow", "friday", "in 3 days"
- ⚡ **Priority levels** — Low / Medium / High
- 🔁 **Recurring tasks** — daily / weekly / monthly auto-repeat
- 📐 **Markdown** — `**bold**`, `*italic*`, `[links](url)`, `` `code` ``
- 🔔 **Notifications** — browser reminders when tasks become due

### UX & Polish
- 🌙 **Dark mode** — persisted preference
- 🎯 **Drag-and-drop reordering**
- ↩️ **Undo toast** — 5-second window to undo deletes
- 🎉 **Completion celebration** — confetti when clearing all active tasks
- 🎬 **Smooth animations** — slide in/out transitions
- 📊 **Statistics** — streak, completion rate, tasks per day
- 💾 **Export / Import JSON** — backup and restore

### Keyboard Shortcuts
- `Enter` — add task / save edit
- `Esc` — cancel edit / close modals / clear search
- `Ctrl/Cmd + /` — focus search
- `Ctrl/Cmd + N` — focus new task input
- `Ctrl/Cmd + D` — toggle dark mode
- `Ctrl/Cmd + Shift + C` — clear completed
- `Ctrl/Cmd + E` — export JSON
- `Shift + Click` — multi-select tasks

## Architecture

```
todo-list-app/
├── index.html           # Semantic structure + sidebar layout
├── style.css            # Theming, responsive layout, animations
├── app.js               # State, persistence, rendering, all features
├── manifest.webmanifest # PWA manifest
├── sw.js                # Service worker for offline support
└── README.md
```

State lives in a single object, persisted to `localStorage` on every mutation. A single `render()` function rebuilds the visible DOM. Event delegation keeps listeners minimal even with hundreds of tasks.

## Running Locally

```bash
# Any static server works; here's a one-liner with Python:
python3 -m http.server 8000
# Then open http://localhost:8000
```

PWA features (offline, install) require serving over `http://localhost` or `https://`. Opening `index.html` via `file://` works for everything except the service worker.

## Roadmap

- [ ] Cloud sync (optional backend)
- [ ] Collaborative shared lists
- [ ] Calendar view
- [ ] Mobile app wrapper

## License

MIT

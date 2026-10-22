# Installable app

EveryOps can be installed as an app: on a desktop it gets its own window and dock or taskbar icon, on a phone or tablet
a home-screen icon that opens full screen. Useful for a front-desk tablet or a counter computer.

## Pieces

- `src/app/manifest.ts`: name, icons, `id` and `scope` "/", standalone display, and a "Your workspaces" shortcut.
- `src/app/layout.tsx`: Apple web-app tags (full screen from the iPhone/iPad home screen, titled EveryOps).
- `public/sw.js`: the service worker. It handles page loads only, always from the network first, and shows
  `public/offline.html` when there's no connection. It caches nothing else, so a release is never served stale. Bump
  its `VERSION` when the offline page changes.
- `src/lib/pwa/install.tsx`: registers the worker and keeps Chrome/Edge/Android's install prompt until it's asked for.
  `useInstall()` says whether EveryOps is installed, can prompt, or is on iPhone/iPad Safari (no prompt there).
- Account menu: **Install app**. It opens the browser's install prompt, or on iPhone/iPad shows the three Share → Add
  to Home Screen steps. Hidden once EveryOps runs installed or where the browser can't install it.

## Offline

The offline page says the workspace needs a connection, has Try again, and reopens the page by itself when the
connection returns. Working offline (saving without a connection) isn't covered.

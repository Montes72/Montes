# Changelog

## Unreleased

### Phase 0 — fork and cleanup

- Forked [coucou](https://github.com/Louis-CFM/coucou) (MIT) and renamed it
  **Montes** (product name, identifier `com.montes.app`, pipe
  `\\.\pipe\montes-<sid>`, `%LOCALAPPDATA%\Montes`, `%APPDATA%\Montes`,
  marker `montes-hook`).
- Windows-only: removed the macOS app (`NotchBuddy/`), the Linux build
  (`platform/linux.rs`, `hook/src/unix.rs`, `tauri.linux.conf.json`, the Linux
  workflow, the Linux packaging), the original docs website and the original
  character media — none of the original assets ship in Montes.
- Dropped features (kept out): macOS app, Linux, Gemini CLI / Antigravity /
  Cursor / Codex pills, Mail, terminal jump, speech, Google AI / OpenAI chat.

### Phase 1 — extra agents

- New **Settings… → Agents** section: register any tool that can run a hook
  command with a name, the full path to its own JSON hook config and the events
  it should report. Montes merges `montes-hook.exe --agent <name> <Event>` into
  that file with the same dated backup, diff and fingerprint guard as the Claude
  Code hooks; uninstall removes only that agent's entries and leaves other hooks
  alone.
- The saved settings gained an `agents` list, and `docs/AGENTS.md` now documents
  the installer and the `PermissionRequest` limitation for third-party agents.

### Phase 3 — our own character

- Drew a character of our own: a superellipse body (n = 2.2), sphere-projected
  eyes (0.27 R × 0.29 R, ±0.35 rad apart, tilted −0.10 rad), a 2 px inverse-tone
  pupil rim and an antenna — a 0.35 R stalk with a 0.14 R dot that wobbles on
  every state change, sways while working and hops on error.
- The body is monochrome: the state colour lives in the halo behind the
  character, the badge and the eye shape; rate limiting gets a diagonal hatch.
- The greeting and the mini bots use the same creature, and `scripts/gen-icons.mjs`
  was rewritten to draw it — the PNG/ICO set under `src-tauri/icons/` is
  regenerated from scratch, so no original artwork remains.

### Phase 6 — a window dropped on the island

- Grab any application by its **title bar** and drop it on the island: Montes
  finds the window under the cursor (`WindowFromPoint` → `GetAncestor`), has it
  redraw itself into an off-screen bitmap (`PrintWindow` with
  `PW_RENDERFULLCONTENT`, the flag GPU-composited windows need), scales it to fit
  with `StretchBlt` and shows it in a card with a rainbow edge.
- **Ask about this** sends the screenshot to Claude as an image block, so the
  answer is about what is on screen. The window's title is all the "URL" we ever
  show — reading a browser tab's real address needs UI Automation.
- A press only arms the gesture when `WM_NCHITTEST` answers `HTCAPTION`, which is
  what separates a window drag from a click, a text selection or a file leaving
  Explorer. The release must also land on the island, at least 40 px from the
  press.
- The detector runs on its own thread for the life of the app rather than inside
  the cursor poll: a window drag starts in another application while the island is
  usually hidden, and a poll parked behind the island's visibility would never see
  the first half of the gesture.
- `capture_window` runs on a blocking thread — `PrintWindow` waits for the other
  application to render, and a busy window must not be able to freeze the island —
  and returns raw bytes (u32 header length, JSON header, RGBA rows) instead of a
  struct of numbers, which JSON would spell out as millions. The screenshot is
  encoded to PNG by the WebView's own canvas when the question is asked, so the
  app still needs no image library.

### Phase 7 — our own sounds, and a build you can carry on a stick

- **All 28 sounds are synthesised from scratch** by `scripts/gen-sounds.mjs` —
  plain additive synthesis in Node, no samples and no dependencies. It runs on a
  deterministic `mulberry32`, writes 44.1 kHz 16-bit mono, and each voice is
  filtered, DC-blocked, mean-removed, tapered over 4 ms and normalised to
  `0.9 × level` in that order, so nothing clips and nothing drifts.
- The Windows build is now **portable**: a folder with `Montes.exe`,
  `montes-hook.exe` and `WebView2Loader.dll`, plus a zip of the same three.
  `bundle.active` is false and there is no installer — the original NSIS build
  tripped Defender with `Trojan:Win32/WacatacH!ml`, which is what an unsigned
  installer unpacking its payload into temp looks like. The `nsis` block stays
  in `tauri.conf.json` for anyone who wants it back behind one flag.
- `WebView2Loader.dll` must ship beside `Montes.exe`. The GNU toolchain links it
  dynamically where MSVC links it statically, and without it the app dies with
  `STATUS_DLL_NOT_FOUND` (0xC0000135) before it can write a log line. Keeping it
  out of `bundle.resources` is deliberate: `pack.mjs` owns the list of what ships,
  so the folder and the zip cannot disagree.
- `pack.mjs` writes the zip itself — `deflateRawSync` and a CRC32 over the
  source, no new dependency — and refuses to produce a broken archive. It starts
  the loose copy, reads back what it logged and fails on a quit code, and it
  refuses outright if `Montes.exe` is already running, because the app is
  single-instance and a second copy hands over and exits without ever reaching
  `setup`.

### Fix — a release build that showed nothing but an error page

- `tauri` decides at compile time which page source to use: with the
  `custom-protocol` feature it serves the embedded `frontendDist`, without it the
  windows are still aimed at `http://localhost:1420`. So **every release build
  made before this fix started perfectly, drew its windows, wrote its log — and
  filled both with Chromium's "localhost refused to connect" page.** Nothing in
  the app ran, and nothing in the output said so.
- `custom-protocol` is now a non-default feature of the `montes` crate. It cannot
  be a default feature: `tauri dev` needs the dev server, and a default that
  flipped it would break the development loop. Release builds must therefore pass
  it explicitly — `cargo build --release --features montes/custom-protocol`.
- Two guards so this cannot come back quietly. The app logs which page source it
  was built against (`pages: bundled assets` or `pages: DEV SERVER …`), and
  `pack.mjs` reads that line back out of the log its own smoke run produced and
  fails the pack if it says dev server.
- `build.rs` now emits `rerun-if-changed` for every file under `../dist`.
  `tauri-build` watches that directory non-recursively, so a bare `cargo build`
  after a frontend change silently relinked a binary carrying the previous build
  of the island.

### Build — the Windows toolchain

- `reqwest` now speaks **SChannel** (`native-tls`) instead of `rustls`. `ring`
  needs a full C compiler to build; SChannel uses the Windows trust store,
  which is the right backend for a Windows-only app anyway.
- The library target is `rlib` only. `staticlib`/`cdylib` exist for the mobile
  targets Phase 0 removed, and on the GNU target the cdylib export table
  overflows the 64k ordinal limit and breaks the link.
- Building without MSVC (`x86_64-pc-windows-gnu`) needs a complete MinGW-w64 GCC —
  `windres` shells out to the C preprocessor, so a bare binutils is not enough —
  and it must run from an **ASCII-only path**: `windres` cannot open the icon
  through a non-ASCII path (`Invalid argument`) and the GNU linker will not find
  objects under one.
- Known and harmless: on the GNU target `ld` reports `.rsrc merge failure:
  multiple non-default manifests` and keeps mingw's minimal manifest, so Tauri's
  `longPathAware` is not applied. `requestedExecutionLevel` already defaults to
  `asInvoker` and DPI awareness is still set at runtime.
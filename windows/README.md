<div align="center">

# Montes for Windows

**Montes doesn't get a notch on a PC — so it lives at the top of your screen instead.**

Approve Claude Code permissions, watch your session work, drop a file, chat with
Claude, keep an eye on your services — without leaving what you're doing.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Using it

| What you do | What happens |
|---|---|
| Move the mouse to the very top-centre of the screen | Montes peeks out |
| Click the small island | It opens |
| Click Montes | It gets annoyed. Three times in a row and it goes dizzy |
| Rest the pointer on Montes for two seconds | Hearts |
| Drag a file onto the island | Montes turns into a box, swallows it, then offers to answer questions about it |
| `Esc` | Closes the island |
| Tray icon | Open, Settings…, Pause, Quit |

Everything else happens on its own: a Claude Code permission request opens the
island with **Deny / Allow**, a finished session shows what it did, and your
integrations sit in the coloured pills next to Montes.

## Claude Code

Open **Settings… → Claude Code → Install hooks…**. You get the exact diff of
what will change in `%USERPROFILE%\.claude\settings.json`, the path of the dated
backup that will be taken, and nothing is written until you click. Your own
hooks are never touched, and uninstalling removes only Montes's entries.

The relay is a tiny executable, `montes-hook.exe`, copied to
`%LOCALAPPDATA%\Montes\bin\` at launch. It is given 300 ms to reach Montes and
exits cleanly if the app is closed, slow or crashed — **a Claude Code session is
never blocked or slowed down by Montes.** If nobody answers a permission request
in time, Montes stays quiet and Claude Code asks in the terminal as usual.

It works from any terminal — Windows Terminal, PowerShell, VS Code, Git Bash.
The relay accepts a `montes_agent` protocol field so any tool can get its own
pill (see [`docs/AGENTS.md`](../docs/AGENTS.md)).

## Agents

**Settings… → Agents** wires any tool that can run a hook command to the same
relay. Add the agent's name, the full path to its own JSON hook config (for
example `%USERPROFILE%\.gemini\settings.json`) and the events it should report;
Montes writes `montes-hook.exe --agent <name> <Event>` into that file with the
same dated backup and diff as the Claude Code section. Each agent gets its own
pill, and `PermissionRequest` is left out — approvals only work for Claude Code.

## Chat and keys

**Settings… → Claude** takes your Anthropic API key. Keys live in the **Windows
Credential Manager**, never on disk and never in the interface — the island can
only ask whether a key exists. Same for every integration key.

No telemetry. The only network requests Montes makes are to the services you
configure yourself.

## Build it yourself

You need [Rust](https://rustup.rs), [Node 20+](https://nodejs.org), and the
**MSVC build tools** (Visual Studio Build Tools with "Desktop development with
C++"). WebView2 ships with Windows 10/11.

MSVC is the supported toolchain and the default `rustup` host, so it needs
nothing special:

```
cargo build --release --features montes/custom-protocol -p montes -p montes-hook
```

The `x86_64-pc-windows-gnu` target also works, but it needs a complete MinGW-w64
GCC (bare binutils is not enough — `windres` shells out to the C preprocessor), the
build has to run from an ASCII-only path because the resource compiler cannot open
the icon through a non-ASCII one, and it needs an explicit `--target`, so its
output lands in `target/x86_64-pc-windows-gnu/release` rather than
`target/release`. `pack.mjs` prefers the MSVC build and falls back to the GNU
one; set `MONTES_TARGET_DIR` to override. Only the GNU build needs
`WebView2Loader.dll` shipped beside the exe — MSVC links WebView2 statically, so
that folder is three files instead of two.

> **Release builds must pass `--features montes/custom-protocol`.** Tauri picks
> the page source at compile time: with that feature the windows serve the
> embedded `frontendDist`, without it they are aimed at `http://localhost:1420`
> and show Chromium's "localhost refused to connect" page. The app logs which one
> it got (`pages: bundled assets` or `pages: DEV SERVER …`), and `npm run pack`
> fails if the log says dev server — but a hand-run `cargo build --release` has
> nothing but that log line to tell you. It cannot be a default feature, because
> `tauri dev` needs the dev server.

```powershell
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run sounds         # regenerates the 28 WAVs from scripts/gen-sounds.mjs
npm run pack           # builds the app and drops the release files in windows/release/
```

`npm run dev` alone serves the front end in an ordinary browser, which is enough
to work on the island's looks. It also serves `dev/upload-preview.html`, which
replays the whole file-drop choreography on a loop — the one part of the UI that
otherwise needs a real drag from Explorer to see. Neither page ships in the app.

`npm run pack` leaves these in `windows/release/`:

```
Montes/                              the runnable folder, also zipped
  Montes.exe                         the assistant
  montes-hook.exe                    the relay it installs for Claude Code
  WebView2Loader.dll                 only in a GNU build — keep it beside the exe
  README.txt                         (in the zip only)
Montes-Windows-X.Y.Z-portable.zip    the versioned archive
Montes-Windows-portable.zip          the same file under the rolling name
```

**There is no installer.** The original NSIS build tripped Defender with
`Trojan:Win32/WacatacH!ml` — an unsigned installer unpacking its payload into
temp looks exactly like a packer does — so `bundle.active` is false and the
supported distribution is the folder you unzip and run. Nothing is installed:
everything Montes writes lives in `%LOCALAPPDATA%\Montes` and `%APPDATA%\Montes`,
so deleting those two folders and the program is gone. The `nsis` block stays in
`tauri.conf.json` if you want the installer back.

`WebView2Loader.dll` is not optional **for a GNU build** and not a build artefact
to clean up. The GNU toolchain links WebView2 dynamically where MSVC links it
statically, and without it a GNU build exits with `STATUS_DLL_NOT_FOUND`
(0xC0000135) before it can write a single log line. An MSVC build does not
produce one, so `pack.mjs` ships it only when it is actually there.

### Sounds

The 28 WAVs live in `windows/shared/sounds/` and are synthesised from scratch by
`scripts/gen-sounds.mjs` — additive synthesis in plain Node, no samples, no
dependencies, no WebAudio. It runs on a seeded `mulberry32`, so the same run
produces the same bytes. The path the app reads is declared once, in
`SOUNDS_DIR` at the top of `vite.config.ts`.

```powershell
npm run sounds        # rewrites every WAV in windows/shared/sounds/
```

### Icons

The app icon and the tray icon are drawn in code, like Montes itself:

```powershell
npm run icons          # regenerates src-tauri/icons from scripts/gen-icons.mjs
```

### Layout

```
windows/
  src/                 island front end (TypeScript, no framework)
    mochi/             Montes and the launch greeting, in Canvas 2D
    island/            state machine, hooks, integrations
    views/             every island view
    settings/          the settings window
    upload/            the file-drop sequence
    core/              state, layout, sounds
  src-tauri/           Rust backend: window, named pipe, Claude API, pollers
  hook/                montes-hook.exe, the Claude Code relay
  shared/sounds/       the generated WAVs
  scripts/             icon generator, sound generator, pack script
```

### Log

`%LOCALAPPDATA%\Montes\montes.log` — hook events, permission decisions, poller
problems. It stays on your machine.

## Not in this version

- Sending a file by email (Mail is macOS-only and was dropped).
- Jumping to a specific terminal window — "Open terminal" opens the working
  folder in VS Code when `code` is on your `PATH`.
- Gemini CLI / Antigravity / Cursor / Codex pills and Google AI / OpenAI chat —
  macOS-only in the original and dropped in the fork. Those tools can still be
  wired by hand through **Settings… → Agents**.
- Speech is scheduled for a later Montes milestone (see the plan).

## Capturing a window

Grab any window by its **title bar** and drop it on the island. Montes asks Windows
which window that is (`WindowFromPoint`), has that window redraw itself into an
off-screen bitmap (`PrintWindow` with `PW_RENDERFULLCONTENT`), and shows it in a
card with a rainbow edge. Press **Ask about this** and the screenshot goes to
Claude as an image, so the answer is about what is on screen — not about the
window's title.

Two things make the gesture safe to leave running all the time:

- A press only arms the gesture if `WM_NCHITTEST` says it landed on a **caption**.
  A click in a window, a text selection, or a file dragged out of Explorer all
  return `HTCLIENT` and are left entirely to the island's normal drop handling.
- The pointer has to travel at least 40 px before the release counts, so a click
  that jitters is not mistaken for somebody carrying a window across the screen.

The picture is scaled to fit the card with `StretchBlt` and handed to the island
as raw RGBA, never as base64 or JSON. Windows a GPU-composites may come back
blank — that is a property of `PrintWindow`, not of the app.
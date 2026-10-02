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

```powershell
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # builds the app and drops the release files in windows/release/
```

`npm run dev` alone serves the front end in an ordinary browser, which is enough
to work on the island's looks. It also serves `dev/upload-preview.html`, which
replays the whole file-drop choreography on a loop — the one part of the UI that
otherwise needs a real drag from Explorer to see. Neither page ships in the app.

`npm run pack` leaves these files in `windows/release/`, the same names the
release workflow publishes:

```
Montes-Windows-X.Y.Z-setup.exe    the versioned installer (NSIS)
Montes-Windows-setup.exe          the same file under the rolling name
```

> **Note:** the NSIS installer is currently unpublished because Defender flags
> it as `Trojan:Win32/Wacatac.H!ml` (a false positive). The supported
> distribution is the portable build — `target/release/montes.exe` runs on its
> own, no install needed.

### Sounds

The WAVs live in `windows/shared/sounds/` and are generated programmatically
(WebAudio → WAV); the path is declared once, in `SOUNDS_DIR` at the top of
`vite.config.ts`.

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
  scripts/             icon generator, pack script
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
- Speech, window capture and the drag-onto-window flow are scheduled for the
  Montes milestones (see the plan).
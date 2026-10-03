<div align="center">

<img src="windows/src-tauri/icons/128x128.png" width="96" alt="Montes icon">

# Montes

**A tiny friend that lives at the top of your Windows screen and keeps an eye on
your AI coding agent sessions.**

Approve permissions, watch your agents work, drop a file, chat with Claude — all
without leaving what you're doing.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

</div>

---

## What it is

Montes is a Windows-only fork of
[Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé. It keeps the
parts that were useful on a PC — the Claude Code hook relay, the tiny animated
assistant at the top of the screen, the seven service pollers, the file-drop
question feature — and drops macOS, Linux, and the macOS-only chat providers.

The character, the name, the sounds and the icons are being built fresh for
Montes; nothing from the original's assets is shipped (see «Assets» below).

## Features

- 🤖 **Claude Code sessions, live** — see what your session reads, edits and
  runs, step by step. Tag a hook payload with `montes_agent` to give any other
  agent its own pill (see [`docs/AGENTS.md`](docs/AGENTS.md)).
- ✅ **Approve from the island** — permission requests show up with
  **Allow / Deny**. One click, back to work. Works from any terminal, and for any
  agent that can wait on the hook's stdout — Claude Code, opencode, or your own.
- 💬 **Chat with Claude** — right from the island, with your own Anthropic key.
- 📎 **Drop a file on the island** — Montes turns into a box, swallows it, then
  answers questions about it.
- 🪟 **Drag a window onto the island** — grab any application by its title bar and
  drop it on Montes. It takes a screenshot with `PrintWindow`, shows it to you, and
  hands the picture to Claude, so "what's this?" gets an answer about what is
  actually on screen.
- 🔌 **Integrations** — Stripe payments, n8n workflows, GitHub, Vercel
  deployments, Resend emails, Notion, Cal.com. Each one gets its own little
  coloured pill.
- 🎭 **A real character** — idle breathing, blinks, eyes that follow your mouse,
  emotes, sounds, a greeting on launch.
- 🫥 **Invisible when idle** — hides away when nothing is running, peeks out
  when you hover the very top of the screen.
- 🗣 **English or Russian** — the whole app, both windows and the tray. A fresh
  install follows the language Windows is set to; change it in
  **Settings… → General** and it switches at once.
- 🔒 **Private by design** — no telemetry, no account. Keys live in the Windows
  Credential Manager. The app only talks to the services you plug in.

## Install

The distributable is a portable `montes.exe` (plus a zip), **not** an installer:
the original NSIS installer tripped Microsoft Defender's
`Trojan:Win32/Wacatac.H!ml` false positive, so until it can be code-signed the
portable build is the supported way to run Montes.

Download the latest `Montes-Windows-*.zip` from the fork's **Releases** page,
unzip it anywhere and run `Montes.exe`. No admin rights needed.

There is no notch on a PC, so the island slides out of the top edge of the
screen instead of hiding inside one. See [`windows/README.md`](windows/README.md)
for the details.

## Build from source

Requirements: [Rust](https://rustup.rs), Node 20+, and the **MSVC build tools**
(Visual Studio Build Tools with "Desktop development with C++"). WebView2 ships
with Windows 10/11.

```powershell
git clone <your-fork>
cd windows
npm install
npm run pack                # builds the app and drops the zip in windows/release/
```

`npm run tauri dev` gives a live-reloading development build.

## Setup

Click the Montes icon in the system tray → **Settings…**

| What | Why | Where the key goes |
|---|---|---|
| **Claude Code hooks** | live sessions and approvals | **Install hooks** — Montes backs up `~/.claude/settings.json`, merges its hooks and shows you the diff before writing anything |
| **Anthropic API key** | chat and questions about files | Settings → Claude · Windows Credential Manager |
| **Ollama** | the same chat, on your own machine and for free | Settings → Assistant — optional; without a key Montes uses it automatically |
| **Агенты** | extra agents with their own names and hook events | their settings merge into `~/.claude/settings.json` with `--agent <name>` |
| Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com | the service pills | Windows Credential Manager, all optional |

If Montes isn't running, the hook exits immediately: **Claude Code is never
blocked.**

## Things to try

| Do this | Montes does that |
|---|---|
| Hover the top edge of the screen | peeks out and says hi 👋 |
| Click it | opens |
| Hover Montes | blinks, eyes grow |
| Click Montes | squish + annoyed |
| Click 3 times fast | 😵 dizzy for a few seconds |
| Drag a file onto the island | turns into a box and swallows it |
| Drag the island onto a window | captures that window as context for Claude |

## How it works

A [Tauri 2](https://tauri.app) app (Rust + TypeScript):

- **Island**: a transparent, always-on-top window at the top centre of the
  screen that never steals focus; click-through is `WS_EX_TRANSPARENT` polling
  of the cursor.
- **Character**: drawn in Canvas 2D at 60 fps — squircle body, eyes projected on
  a sphere, spring animations. No Rive, no Lottie, no images.
- **Claude Code**: a tiny `montes-hook.exe` relay receives hook events and
  forwards them over a named pipe to the app. For approvals it waits for your
  click, then answers the hook. A hook that finds no Montes exits cleanly
  immediately.
- **Integrations**: lightweight pollers, paused when nothing is watching.
- **Chat**: Anthropic's Messages API with your key and server-side web search — or
  a model on your own machine through Ollama, chosen automatically when there is
  no key.

Details in [`windows/README.md`](windows/README.md).

## Documentation

- [`docs/AGENTS.md`](docs/AGENTS.md) — the `montes-hook` relay and the agent
  protocol.
- [`docs/SPEC.md`](docs/SPEC.md), [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) —
  the original design and integration specs (French, and describing the
  original macOS app). Kept as reference material for the Montes rebuild.

## Contributing

Issues and PRs are very welcome — new integrations, new emotes, new sounds, bug
fixes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Montes is a Windows-only fork of [Coucou](https://github.com/Louis-CFM/coucou),
built by [Louis Raillé](https://louisraille.fr) with Claude Code. The original
project is independent and not affiliated with the design studios whose
notch-companion concepts inspired it.

## License

- **Code:** [MIT](LICENSE) — use it, fork it, learn from it, just keep the
  copyright notice.
- **Assets:** the original name (Coucou), the Mochi character, the sounds and
  the icons are © Louis Raillé. Montes ships none of them: its name, character,
  sounds and icons are original to this project and are MIT-licensed code that
  draws its own shapes at runtime.
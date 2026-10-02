# Montes — guide for AI coding agents

Montes is the Windows-only fork of Coucou. It is a Tauri 2 app (Rust + TypeScript)
living in `windows/`: a small animated character sits at the top of the screen,
shows Claude Code sessions and a few integrations, and lets the user approve,
answer, chat and drop files without leaving what they're doing.

## Where things are
- `windows/src-tauri/` — the Rust backend: the transparent island window
  (`platform/windows.rs`), the named pipe and approval flow (`pipe.rs`), the
  Claude Code hooks manager (`hooks.rs`), the Claude chat (`claude.rs`), the
  seven service pollers (`integrations.rs`), files inbox/ingest (`files.rs`),
  secrets in the Windows Credential Manager (`secrets.rs`).
- `windows/hook/` — `montes-hook.exe`, the tiny relay Claude Code runs on every
  hook event. Never blocks Claude Code.
- `windows/src/` — the front end (TypeScript, no framework):
  `island/` (state machine, hooks, integrations), `views/` (every island view),
  `mochi/` (the character and its greeting, in Canvas 2D), `settings/`,
  `upload/` (the file-drop sequence), `core/` (state, layout, sounds).
- `windows/shared/sounds/` — the WAVs, generated programmatically. The single
  source of truth for the path is `SOUNDS_DIR` at the top of
  `windows/vite.config.ts`.
- `windows/scripts/` — `gen-icons.mjs` (draws the app/tray icons), `pack.mjs`
  (copies Tauri's bundles into `windows/release/` with release names).
- `docs/SPEC.md`, `docs/INTEGRATIONS.md`, `docs/AGENTS.md` — the original
  specifications (French, describing the original macOS app) kept as reference.
- `docs/AGENTS.md` — the `montes-hook` relay and the agent protocol.

## Build
```
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # portable zip + exe in windows/release/
```

## Rules
- Windows 10/11 x64 only. No macOS `NotchBuddy/`, no Linux code: keep it that
  way — do not re-add `#[cfg(unix)]` branches or platform abstractions.
- Tauri 2, Rust + TypeScript. The character is drawn in Canvas 2D, no
  Rive/Lottie/images.
- Secrets live in the Windows Credential Manager, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block Claude Code: if the app doesn't answer within its deadline, the
  hook exits immediately and the terminal takes over.
- Never overwrite `~/.claude/settings.json`: dated backup, merge, show the
  diff, write only after the user confirms.
- Never send an email or approve a Claude Code permission without an explicit
  click.
- Performance: 0 % CPU when the island is hidden. Pollers pause when nothing
  watches them.
- Keep the branded constants consistent: product name `Montes`, identifier
  `com.montes.app`, pipe `\\.\pipe\montes-<sid>`, `%LOCALAPPDATA%\Montes`,
  `%APPDATA%\Montes`, marker `montes-hook`.
- Existing views stay exactly as they are: never restyle what already ships
  unless explicitly asked.
- Pill IDs are stable contract values (Credential Manager, settings, hook
  routing): never rename an existing pill ID.
- New views follow the existing app style.
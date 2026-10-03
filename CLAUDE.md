# Montes — guide for AI coding agents

Montes is the Windows-only fork of Coucou. It is a Tauri 2 app (Rust + TypeScript)
living in `windows/`: a small animated character sits at the top of the screen,
shows Claude Code sessions and a few integrations, and lets the user approve,
answer, chat and drop files without leaving what they're doing.

## Where things are
- `windows/src-tauri/` — the Rust backend: the transparent island window
  (`platform/windows.rs`), the named pipe and approval flow (`pipe.rs`), the
  Claude Code hooks manager and the extra-agent installer (`hooks.rs`), the
  opencode plugin it installs (`opencode.rs`, whose template lives in
  `resources/opencode/montes.ts`), the chat and its provider rule (`chat.rs`), the
  two back ends it dispatches to (`claude.rs` for the Anthropic API, `ollama.rs`
  for a model on the user's own machine), the seven service pollers
  (`integrations.rs`), files inbox/ingest (`files.rs`), secrets in the Windows
  Credential Manager (`secrets.rs`).
- `windows/hook/` — `montes-hook.exe`, the tiny relay Claude Code runs on every
  hook event. Never blocks Claude Code.
- `windows/src/` — the front end (TypeScript, no framework):
  `island/` (state machine, hooks, integrations), `views/` (every island view),
  `mochi/` (the character and its greeting, in Canvas 2D), `settings/`,
  `upload/` (the file-drop sequence), `core/` (state, layout, sounds).
- `windows/shared/sounds/` — the 28 WAVs, synthesised from scratch by
  `scripts/gen-sounds.mjs` (additive synthesis in plain Node, seeded, no
  dependencies). The single source of truth for the path is `SOUNDS_DIR` at the
  top of `windows/vite.config.ts`.
- `windows/scripts/` — `gen-icons.mjs` (draws the app/tray icons),
  `gen-sounds.mjs` (synthesises the WAVs), `pack.mjs` (writes `windows/release/`
  and the portable zips).
- `docs/SPEC.md`, `docs/INTEGRATIONS.md` — the original specifications (French,
  describing the original macOS app) kept as reference.
- `docs/AGENTS.md` — the `montes-hook` relay and the agent protocol.

## Build
```
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run sounds         # regenerates the 28 WAVs
npm run pack           # portable folder + zips in windows/release/
```

### Release builds need an explicit feature
Tauri picks the page source at compile time. With `custom-protocol` the windows
serve the embedded `frontendDist`; without it they are aimed at
`http://localhost:1420` and show Chromium's "localhost refused to connect" page.
The app starts perfectly and writes a normal log either way, so nothing but the
log tells you:

```
cargo build --release --features montes/custom-protocol -p montes -p montes-hook
```

`%LOCALAPPDATA%\Montes\montes.log` records `pages: bundled assets` or
`pages: DEV SERVER …`. `npm run pack` fails on the second. It cannot be a default
feature — that would break `tauri dev`, which needs the dev server.

### Toolchains
MSVC (Visual Studio 2022 Build Tools + `stable-x86_64-pc-windows-msvc`) is the
supported one and is the default `rustup` host, so `cargo build --release` just
works. The GNU target works as a fallback but needs a full MinGW-w64 GCC and an
ASCII-only checkout path, and takes an explicit `--target`, so its output lands
in `target/x86_64-pc-windows-gnu/release`. `pack.mjs` prefers the MSVC build and
falls back to the GNU one; `MONTES_TARGET_DIR` overrides.

Run the tests with MSVC:

```
call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cargo test --release -p montes -p montes-hook
```

They do not run on the GNU target: the binaries die at startup with
`0xC0000139` (STATUS_ENTRYPOINT_NOT_FOUND).

## Rules
- Windows 10/11 x64 only. No macOS `NotchBuddy/`, no Linux code: keep it that
  way — do not re-add `#[cfg(unix)]` branches or platform abstractions.
- Tauri 2, Rust + TypeScript. The character is drawn in Canvas 2D, no
  Rive/Lottie/images.
- Secrets live in the Windows Credential Manager, never on disk or in git.
- No telemetry. Network calls only to services the user configured.
- Never block Claude Code: if the app doesn't answer within its deadline, the
  hook exits immediately and the terminal takes over.
- Never overwrite a hook config: dated backup, merge, show the diff, write only
  after the user confirms. This covers `~/.claude/settings.json` and each agent
  config registered in **Settings… → Agents**.
- Never send an email or approve a Claude Code permission without an explicit
  click.
- Performance: 0 % CPU when the island is hidden. Pollers pause when nothing
  watches them.
- Keep the branded constants consistent: product name `Montes`, identifier
  `com.montes.app`, pipe `\\.\pipe\montes-<sid>`, `%LOCALAPPDATA%\Montes`,
  `%APPDATA%\Montes`, marker `montes-hook`.
- Never write a file into another tool's config without the same contract the
  Claude Code hooks get: dated backup, diff shown first, an explicit click, and a
  fingerprint so a file that changed underneath is never overwritten. Refuse to
  edit or delete a file Montes did not write, even when only the name matches.
- Never show a decision the other tool cannot receive. If a tool's API cannot
  answer a permission request, the island says one is waiting instead of showing
  Allow / Deny that would go nowhere.
- Existing views stay exactly as they are: never restyle what already ships
  unless explicitly asked.
- Pill IDs are stable contract values (Credential Manager, settings, hook
  routing): never rename an existing pill ID.
- The provider rule belongs to Rust: `chat::resolve` decides who answers and
  explains why, and the settings window shows that answer. Never let the front end
  reimplement the rule.
- User-visible text goes through `t()` (`core/i18n.ts`), and **the English string
  is the key** — never invent a key like `settings.language`, and never rename an
  English sentence that is already a key without translating both sides. Most text
  needs no call at all: `views/dom.ts` translates everything handed to `h()`.
  Reach for `t()` directly only where the DOM is bypassed (canvas labels,
  `.textContent`, the ticker). Data is not a key: a project name, a model's answer
  and a Rust error are passed through untouched. `npm run build` runs
  `scripts/check-i18n.mjs`, which fails the build on a key nothing says any
  more, a sentence on screen with no translation, a sentence glued together at
  runtime instead of composed from holes, and a `{hole}` the call site does not
  fill — the last two are invisible in English and to `tsc`.
- New views follow the existing app style.
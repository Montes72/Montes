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
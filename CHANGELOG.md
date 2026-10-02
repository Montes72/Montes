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
# Contributing to Montes

Thanks for wanting to help Montes grow up! 🫶

## Getting started

Montes is Windows-only. You need [Rust](https://rustup.rs), Node 20+ and the
MSVC build tools (see `windows/README.md`).

```powershell
cd windows
npm install
npm run tauri dev      # live-reloading development build
```

## Good first contributions

- A new service integration (a poller in `src-tauri/src/integrations.rs` +
  an entry in the pill catalog in `src/core/layout.ts` in the `.service`
  category + a detail card). Look at `StripePoller` for a compact example.
- A new agent: any agent already gets its own automatic pill by sending
  `montes_agent` in its hook payload (see `docs/AGENTS.md`). Add an entry in
  the pill catalog only if you want it to be declarable in Settings.
- A new emote or sound for Montes.
- Bug fixes — please describe how to reproduce.

## Rules of the house

- Rust + TypeScript, Tauri 2. The character is drawn in Canvas 2D — no
  Rive/Lottie/images.
- Windows 10/11 x64 only. Do not re-add macOS or Linux code.
- Secrets go in the Windows Credential Manager, never on disk or in git.
- No telemetry, no network calls except to services the user configured.
- Never block Claude Code: if the app doesn't answer, the hook must exit right
  away.
- Never write `~/.claude/settings.json` without a backup and the user's
  confirmation.
- Keep it light: 0 % CPU when the island is hidden.

## Pull requests

- One topic per PR, with a short GIF or screenshot for anything visual.
- Build must pass with no new warnings.
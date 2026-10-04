# Changelog

## Unreleased

### Phase 11 — an installer, and a portable build that stays honest

- **Montes installs now.** `npm run dist` builds `Montes-Windows-X.Y.Z-setup.exe`
  next to the portable zip: an NSIS installer that asks per-user or all-users,
  writes a Start menu entry, and uninstalls through a real uninstaller. `npm run
  pack` still builds the portable-only path, so a machine where an unsigned
  installer is refused still has something to run.
- **The program does not live in the data folder.** NSIS `currentUser` mode
  hardcodes the install directory to `$LOCALAPPDATA\<product name>`, which for
  this app is exactly where `bin\`, `inbox\` and the log live. Installing there
  would have put `Montes.exe` and `uninstall.exe` in the same directory as the
  state a user is allowed to delete — the arrangement that turns "remove the
  program" into "lose my things". `installMode: both` moves the per-user default
  to `%LOCALAPPDATA%\Programs`, where Windows itself keeps per-user applications,
  and keeps an all-users install one click away for anyone who wants it.
- **The install folder is a choice, not a constant — except when it is silent.**
  The *Choose install directory* page has a Browse button, so an interactive
  install can put the program on any drive. A silent install cannot: the page is
  `SkipIfPassive`, and NSIS's `/D=` is overridden by the template's own
  `StrCpy $INSTDIR`, so `setup.exe /S /D=D:\Apps\Montes` quietly installs to the
  default and reports success. What a silent install *does* follow is the location
  an earlier install remembered, which is also how an upgrade stays where the
  program already is — so install once interactively, pick the folder there, and
  every later install follows it.
- **The uninstaller pins the shell context before it deletes anything.**
  `$LOCALAPPDATA` in an NSIS script follows the *install* context, and an
  all-users install points it at `C:\Users\Default` — a directory that belongs to
  nobody. A hook that built a path from it would have quietly missed the real
  files, and the leftover relay would have kept answering hooks for an app that
  is no longer installed. `SetShellVarContext current` first, because Montes is a
  single-user app and its data is always the current user's.
- **A silent uninstall no longer pins the next install to a dead folder.** The
  installer remembers where it put the program, in
  `HKCU\Software\<manufacturer>\<product>`, so that an upgrade lands in the same
  place — and Tauri clears that key only when the uninstall page has "delete app
  data" ticked, which `/S` never does. So the key outlived the installation and
  the next install reused it silently, which is how `bundle.active` coming back
  would have put `Montes.exe` into `%LOCALAPPDATA%\Montes` — the folder holding
  `bin\`, `inbox\` and the log — and kept putting it there whatever the install
  directory was configured to be. The uninstall hook now clears it, guarded at
  compile time so an empty manufacturer cannot expand into `Software\`.
- **`npm run pack` picks the build you just made.** It chose the first target
  directory that contained a `montes.exe` rather than the newest one, so an old
  explicit-`--target` build sitting in the tree won over the current one — and the
  staleness check then failed with "rebuild before packing" immediately after a
  successful rebuild, which reads as the user's mistake rather than the script's.
  The same script also never cleaned `release/`, so a file that had stopped being
  part of the distribution stayed there looking like part of it — the MSVC build
  drops `WebView2Loader.dll`, and the loose copy outlived both the archive and the
  build that produced it. Stale outputs are pruned now, and only names the script
  writes are considered, so a file a person dropped in there survives.
- **Uninstalling does not reach into other people's configuration.** It removes
  the program, its Start menu entry, `%LOCALAPPDATA%\Montes\{bin,inbox}` and the
  log. It leaves `%APPDATA%\Montes\settings.json` so that reinstalling is not a
  reset, and it does not touch `~/.config/opencode/plugins/montes.ts` or Claude
  Code's `settings.json` — those belong to the user, may carry hooks from other
  tools, and an uninstaller with no diff and no consent has no business rewriting
  them. **Settings → Uninstall hooks** removes those, with the diff shown first.
- **What Defender thinks of it.** A machine-local scan of the current installer
  comes back clean, so the `Trojan:Win32/Wacatac.H!ml` verdict that kept
  `bundle.active` false is a reputation judgement about an unsigned binary rather
  than a finding — unsigned installers that unpack into `%TEMP%` look like
  packers, and there is no reputation to appeal to yet. Publishing stays paused in
  the workflow until the binary is signed or the detection is cleared; the
  portable build is what a user is pointed at in the meantime.

### Phase 10 — a Russian interface

- **The whole app speaks Russian**, chosen in **Settings… → General**. English is
  the source language and the English sentence *is* the key, so there is one copy
  of every line: it stays readable in the code, and a language that is missing a
  sentence falls back to English rather than showing a key or an empty row.
  Both windows, the island, the drop card and the tray menu are covered, and the
  switch takes effect at once in each of them rather than asking for a restart.
- **Translation happens in one place.** `views/dom.ts` is where text enters the
  DOM, so that is where the lookup happens: a new sentence is translated by
  adding it to the dictionary, not by finding the view that says it. The handful
  of places that write text directly — canvas labels, the ticker, the few
  `.textContent` calls — call `t()` by hand, and those are the only places a
  contributor has to remember.
- **A fresh install follows Windows.** Nobody is asked which language they want
  before the app has said anything; it starts in the one Windows is set to and
  remembers the answer from then on.
- **What stays English on purpose.** An error that quotes a path, a port or a flag
  is not translated, and neither is a project name, a model's answer or a commit
  hash: half-translating a sentence that quotes a file path helps nobody. The
  boundary is drawn at *whose words these are*, not at *which window they appear
  in*.
- The Russian wording for the Assistant card — the sentence that says which back
  end would answer and why — is the one piece of Rust that translates, because it
  is interface, not detail.

### Phase 9 — opencode, and Allow / Deny for any agent

- **opencode is a supported agent.** It is not a hook config to merge into — it
  loads plugins from files — so Montes ships one and installs it under the same
  contract as everything else it writes: the whole file shown as a diff, a dated
  backup, an explicit click, and a refusal to touch a file Montes did not write.
  The plugin maps opencode's own events onto the relay (`session.created`,
  `session.idle`, …), reports the user's prompt **once per
  message** instead of once per streamed chunk, and is deliberately silent about
  anything else. It is written so that a missing, broken or slow relay costs an
  opencode session nothing.
- **The plugin works on both opencode plugin APIs.** opencode 2 replaced the API
  outright — `event` became `ctx.event.subscribe`, and `tool.execute.*` stopped
  being events at all — so the file from Phase 9 no longer loaded at all, and an
  opencode user got no pill and no error explaining why. The shipped file now
  carries both entry points (`setup()` for 2.x, `server()` for 1.18.29+), so the
  upgrade cannot silently turn the pill off in either direction. The prompt also
  moved from the message stream to the `prompt` hook: opencode re-emits a part as
  it streams, and a text part does not say whether it is the user's words or the
  model's reply.
- **A relay path can no longer arrive mangled.** The path is written into a
  double-quoted JavaScript string, where `C:\Users\…\bin\montes-hook.exe` contains
  `\b` — a backspace. The plugin installed, reported itself installed, and then did
  nothing at all. Montes writes the path with forward slashes, which `spawnSync`
  accepts on Windows, and a test holds the written file to that.
- **opencode sessions are not held up by a pill nobody is watching.** The relay
  runs synchronously so states cannot arrive out of order, which means its timeout
  is paid on opencode's thread. Only the permission badge waits for a human; every
  other update now gets a fraction of the old budget.
- **opencode's permission asks are a badge, not a card.** Its plugin API can see a
  request and has no way to answer one, so an Allow / Deny card would be a
  decision that could never reach the tool. The pill says what is waiting and the
  answer stays where opencode asks it.
- **An agent plugged in through the relay can now be approved from the island.**
  Until now `PermissionRequest` was the one event a third-party tool could not
  report: its request was declined on arrival and its user re-asked in the
  terminal, so a tool like opencode was watchable but not answerable. Any hook that
  can wait on stdout now gets the same **Allow / Deny** card Claude Code does,
  named after the agent that asked — not after whichever pill happens to be in
  front, which would have been a lie on a busy screen. `ApprovalInfo` carries the
  asking pill so answering puts *that* agent back to work.
- **The decision on stdout is now the decision object itself** for anyone but
  Claude Code: `{"behavior":"allow"}` / `{"behavior":"deny","message":"Denied
  from Montes"}`. Only the `hookSpecificOutput` envelope is Claude's, and a tool
  that has never heard of it would have waited out its own timeout while reading
  something it could not parse. Nothing on stdout still means "nobody decided" —
  ask your own user, exactly as if Montes were closed.
- An agent whose session ends **while its card is up** no longer leaves a request
  on screen that can never be granted: the card goes back to the terminal and the
  pill is removed.
- **There is now a way to check the island that cannot be fooled.** It is a
  transparent overlay with a canvas-drawn pill, so a screen grab shows whatever is
  in front of it — a fullscreen game is enough — `PrintWindow` returns an empty
  bitmap for its WebView2 surface, and `innerText` reads the same whether a pill is
  up or not. `docs/AGENTS.md` now takes the screenshot through the browser's debug
  port instead, which occludes nothing, and says which questions to ask the page
  when a blank capture is ambiguous.

### Phase 8 — an assistant that runs on your own machine

- **Ollama is a second back end for the chat.** With an Anthropic API key saved
  the island still talks to Claude; without one it talks to the model running on
  the user's own machine, so a fresh install has an assistant that works instead
  of one that asks for money. The rule is deliberately dull — a key means Claude,
  no key means Ollama — because anything cleverer would surprise somebody who has
  deliberately removed a key to stop being billed. It can also be pinned to either
  one in **Settings… → Assistant**.
- **Settings… → Assistant** shows which back end would answer *right now*, with
  the reason. Rust owns that rule and answers a `chat_provider` call; the window
  shows the answer rather than reimplementing it, which is the only way
  "automatic" can't quietly disagree with the app. The Ollama rows list what is
  installed, fetched from `/api/tags`, and mark each model's real capability from
  `/api/show` — a text-only model is labelled as such rather than being handed a
  screenshot it would silently drop. The list asks for itself as soon as the rows
  are on screen, because Ollama answers on the loopback interface in milliseconds
  and making the user press a button for that would be the app doing its own work
  badly. When nothing answers, the window says what is missing — no key and no
  Ollama is a fresh install, and it gets told so rather than an empty dropdown.
- The two back ends keep history in genuinely different shapes — Anthropic stores
  typed blocks and may carry tool calls across turns, Ollama stores a text string
  and a side array of pictures — so **switching back ends starts a new
  conversation** instead of feeding one backend's syntax to the other, which is
  the only behaviour that cannot produce nonsense.
- `claude.rs` no longer owns the conversation: `chat.rs` holds the history, the
  attachments and the provider rule, and each provider only translates what is
  genuinely its own. Anthropic gets `document` and `image` blocks; Ollama gets the
  same picture as a bare base64 string, and is told outright that a PDF is
  something it cannot read rather than being sent the bytes as text.
- Ollama asks for a **ten-minute** chat timeout instead of the API's 90 s — 30B
  parameters on a laptop CPU need minutes, and reusing the API's budget cut off
  every long answer. Measured on a laptop with `qwen3:14b`: a cold first question
  took **95 s**, which the API's budget would have cut off — and keeps the model
  loaded for 10 minutes, because reloading a 17 GB model between questions is not
  a cache being trimmed.
- A **thinking model that spends its whole budget thinking** is told what
  happened instead of returning an empty answer. qwen3 and its relatives think
  before they reply and the thinking counts against the same `num_predict`, so a
  truncated answer is genuinely empty — Montes says so, and says what to do,
  rather than showing "no response text".
- A recent Ollama says what each model can do **in `/api/tags` itself**, so the
  capability is taken from the listing when it is there and only asked again per
  model on an older server. Verified against Ollama 0.35: `qwen3-coder:30b` and
  `qwen3:14b` both report `completion, tools` and no `vision`, which is exactly
  why the dropped-window feature refuses them by name.
- A dropped window is checked against the model's capabilities *before* the
  request goes out, so a text-only model is refused with an explanation instead of
  answering as if it had seen the picture.

### Fix — a settings file saved by Notepad lost every setting

- Editing `%APPDATA%\Montes\settings.json` by hand and saving it from Notepad
  wiped the user's preferences without a word. Notepad writes UTF-8 with a
  byte-order mark, `serde_json` rejects one, and the rejection was absorbed by
  `unwrap_or_default()` — so the app came back up on stock settings and behaved
  as if nothing had ever been chosen. `load` now skips a leading BOM.
- The same silent reset hid every other reason a settings file might not parse,
  so a file that is genuinely broken is now reported in `montes.log` instead of
  being replaced without a trace. A first run, which has no file at all, stays
  quiet.
- Found the hard way: this is what happened to the machine this was built on
  while testing the language picker.

### Fix — the question never reached the model

- Splitting the chat into `chat.rs` and the two providers introduced a bug that
  compiled and looked right: the request was built from a history snapshot taken
  **before** the user's turn was recorded, so every request carried the
  conversation *minus* the question — and the model answered it with complete
  confidence and total nonsense. `Chat::turn` now records the question and returns
  what the request must carry in one step, so no provider can send a history that
  has not caught up with it, and `Chat::begin` reports whether this is the first
  turn instead of handing out a snapshot to hold on to.

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

- **MSVC is now the supported toolchain** (Visual Studio 2022 Build Tools, MSVC
  14.44, plus the `stable-x86_64-pc-windows-msvc` Rust host). It is the default
  `rustup` host, so a release build needs no path juggling at all — no MinGW, no
  ASCII-only checkout path, no hand-written `PATH`.
- The 12 Rust tests now run. On the GNU target they compiled and then died at
  startup with `0xC0000139` (STATUS_ENTRYPOINT_NOT_FOUND), which meant the hook
  tests had never actually executed here.
- One of those tests failed for real: `an_agents_hooks_never_collide_with_claudes_or_with_each_other`
  asserted that removing an agent takes a whole event key with it, while building
  its fixture with Claude's *full* event list — so Claude also held `Stop`, and
  the key correctly stayed. The test was wrong, not the code. It now gives Claude
  one event so the "last owner leaves, key goes" case is reachable, and adds the
  mirror-image check that removing an agent must not take Claude's own hook with
  it.
- `pack.mjs` picks the build directory itself: MSVC's `target/release`, or a GNU
  `target/<triple>/release`, overridable with `MONTES_TARGET_DIR`. It ships
  `WebView2Loader.dll` only when the build actually produced one — MSVC links
  WebView2 statically, so an MSVC build is a 2.70 MB zip instead of 2.93 MB and a
  3-file folder instead of 4.
- `reqwest` now speaks **SChannel** (`native-tls`) instead of `rustls`. `ring`
  needs a full C compiler to build; SChannel uses the Windows trust store,
  which is the right backend for a Windows-only app anyway.
- The library target is `rlib` only. `staticlib`/`cdylib` exist for the mobile
  targets Phase 0 removed, and on the GNU target the cdylib export table
  overflows the 64k ordinal limit and breaks the link.
- The GNU toolchain (`x86_64-pc-windows-gnu`) still works as a fallback and needs
  a complete MinGW-w64 GCC —
  `windres` shells out to the C preprocessor, so a bare binutils is not enough —
  and it must run from an **ASCII-only path**: `windres` cannot open the icon
  through a non-ASCII path (`Invalid argument`) and the GNU linker will not find
  objects under one.
- Known and harmless: on the GNU target `ld` reports `.rsrc merge failure:
  multiple non-default manifests` and keeps mingw's minimal manifest, so Tauri's
  `longPathAware` is not applied. `requestedExecutionLevel` already defaults to
  `asInvoker` and DPI awareness is still set at runtime.
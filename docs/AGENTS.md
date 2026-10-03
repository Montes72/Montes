# Montes — third-party agent integration

Any tool that can talk to Montes' named pipe can send events and get its own
pill next to Claude Code.

## The `montes_agent` field

Add the optional field `montes_agent` to any hook JSON payload. Montes will
create a pill labelled with the agent name and route all events to it.

**Validation:** the name must match `^[a-z0-9-]{1,24}$` (lowercase letters,
digits and hyphens, 1–24 characters). An absent or invalid name routes the
event to the Claude Code pill instead. `claude` is reserved.

## Hook command (Windows)

Configure your tool to call the relay with `--agent <your-name>` after the
executable:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "type": "command", "command": "C:\\path\\to\\montes-hook.exe --agent my-tool" }
    ]
  }
}
```

The relay reads the hook JSON on stdin, adds the terminal context (`cwd`), and
hands it to Montes over the pipe `\\.\pipe\montes-<user-SID>`. If Montes is not
running it exits immediately with nothing on stdout — Claude Code is never
blocked.

## Easy path: Settings → Agents

You do not have to edit the file by hand. **Settings… → Agents** takes the
agent's name, the full path to its own JSON hook config and the events it should
report, then writes `"<…>\montes-hook.exe" --agent <name> <Event>` into that
file. It shows the diff first and takes a dated backup; uninstalling removes only
that agent's entries and never touches anybody else's hooks in the file. The
same caveats as above apply — an absolute path, and the hook has to be able to
wait for a decision if you want the approval card.

## Payload format

The relay adds `montes_agent` to the JSON it forwards to the island. You can
add it yourself if you talk to the pipe directly:

```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "my-session-1",
  "montes_agent": "my-tool",
  "prompt": "Running task…"
}
```

## Supported events

Every standard Claude Code hook event is supported, `PermissionRequest` included:
an agent whose hook can wait and read stdout gets the island's **Allow / Deny**
card like Claude Code does. All the others are fire-and-forget — the relay writes
nothing and your session carries on.

The pill lifecycle:

| Event | Effect |
|---|---|
| `SessionStart` | Creates the pill (if absent), sets state to idle |
| `UserPromptSubmit` | State → thinking; prompt shown in ticker |
| `PreToolUse` | State → working; tool label shown in ticker |
| `PostToolUse` / `PostToolUseFailure` | State → working |
| `Notification` | Rate-limit or question state if applicable |
| `Stop` | State → finished for 5 s, then the pill is removed |
| `StopFailure` | State → error |
| `SessionEnd` | Pill removed |
| `SubagentStart` / `SubagentStop` | Step added to ticker |

## Approval cards for your agent

Send `PermissionRequest` and the island shows the same card Claude Code gets:
your agent's name, the command or path being authorised, and **Allow / Deny**.

```json
{ "hook_event_name": "PermissionRequest", "session_id": "s1", "montes_agent": "my-tool",
  "tool_name": "bash", "tool_input": { "command": "rm -rf build" } }
```

Your hook must **wait for the relay's stdout**, and read a decision out of it:

| Written by a human | On your stdout |
|---|---|
| Allow | `{"behavior":"allow"}` |
| Deny | `{"behavior":"deny","message":"Denied from Montes"}` |

Nothing on stdout means nobody decided: treat it exactly as if Montes were closed
and ask your own user. That is also what happens when the island is closed, paused,
or another request already holds the card — so **always keep a timeout** and let
the tool ask in the terminal when it expires. Montes gives up after ~108 s, so a
hook timeout above that is the safe side.

This decision object is Claude Code's own, minus the `hookSpecificOutput`
envelope that only Claude Code knows how to read — the envelope is the one part
of Claude's protocol that is not a shared standard.

## Agent pills vs the Claude pill

- The **Claude Code** pill is always there; it keeps the project name and
  resets to idle after a session instead of disappearing.
- An **external agent** gets a dynamic pill labelled with its `montes_agent`
  name, coloured from the name. It appears when its session starts and is
  removed when the session ends.
- **Settings → Active pills** picks which integration pills stay visible next
  to the character (the services and their keys live in the Windows Credential
  Manager).

## Any other tool

Follow the generic pattern:

```
montes-hook.exe --agent <your-name> <EventName>
```

and let the relay forward the event.

## opencode, worked through

opencode is not a hook config to merge into — it loads plugins from files — so
Montes ships one and puts it in the right place for you.

**Settings… → Agents → opencode → Install…** shows the whole file as a diff, takes
a dated backup, and writes `~/.config/opencode/plugins/montes.ts` (or under
`OPENCODE_CONFIG_DIR`, if you moved opencode's config). Restart opencode
afterwards: plugins are read at startup, not per event. Uninstalling removes that
one file, and refuses to touch a file Montes did not write.

The plugin reports:

| opencode event | Montes |
|---|---|
| `session.created` | `SessionStart` |
| `message.part.updated` (a text part) | `UserPromptSubmit` — once per message, not per chunk |
| `tool.execute.before` | `PreToolUse`, with the tool and its arguments |
| `tool.execute.after` | `PostToolUse` |
| `permission.asked` | `Notification`: "bash needs permission?" |
| `session.idle` | `Stop` |
| `session.error` | `StopFailure` |
| `session.deleted` | `SessionEnd` |

**Permission asks are a badge, not a card.** opencode's plugin API can see a
permission request but has no way to answer one, so the island would be showing a
decision it cannot deliver. Montes says what is waiting and leaves the answer where
opencode asks it — in the terminal opencode is already sitting in.

## Quick test (Windows)

With Montes running, from PowerShell:

```powershell
'{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello","montes_agent":"demo"}' |
  & "$env:LOCALAPPDATA\Montes\bin\montes-hook.exe" UserPromptSubmit
```

A "demo" pill should appear in the island.
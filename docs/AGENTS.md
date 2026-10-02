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
same caveats as above apply — an absolute path, and no `PermissionRequest`.

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

All standard Claude Code hook events are supported, **except `PermissionRequest`**:
approval cards are not yet implemented for third-party agents (only Claude Code
gets one). A `PermissionRequest` from an external agent is answered immediately
with no decision, so the relay writes nothing and the agent re-asks in its
terminal.

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

## Quick test (Windows)

With Montes running, from PowerShell:

```powershell
'{"hook_event_name":"UserPromptSubmit","session_id":"t1","prompt":"hello","montes_agent":"demo"}' |
  & "$env:LOCALAPPDATA\Montes\bin\montes-hook.exe" UserPromptSubmit
```

A "demo" pill should appear in the island.
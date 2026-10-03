// Montes — the opencode plugin.
//
// Written by Montes itself (Settings… → Agents). It talks to the app through
// montes-hook.exe, the same relay Claude Code uses, so an opencode session gets
// its own pill next to it: thinking, working, finished, gone — and a badge when
// opencode is waiting on the user.
//
// Two rules this file lives by:
//   * an opencode session is never broken by Montes. Every call is wrapped, a
//     relay that is missing, broken or slow costs this session nothing, and the
//     plugin never waits long enough to be noticed;
//   * nothing here is a promise opencode cannot keep. A permission ask arrives as
//     a *badge*, not as Allow/Deny: opencode's plugin API can see a permission
//     request but cannot answer one, and a card that never reaches the tool would
//     be a lie. The answer happens in the opencode terminal, as usual.

import { spawnSync } from "node:child_process"

// Replaced with the relay's absolute path when Montes writes this file.
const RELAY = "__MONTES_RELAY__";
// The pill this session owns. `^[a-z0-9-]{1,24}$` and not "claude", or the app
// routes the event to the Claude Code pill instead.
const AGENT = "opencode";
/** The relay gives up on anything that is not a permission card after this. */
const BUDGET_MS = 2000;

type Payload = Record<string, unknown>;

/**
 * opencode re-emits a message as it streams, so the prompt would otherwise be
 * reported once per token. Remembering the message ids we have already sent is
 * what makes "the user asked something" one event instead of a hundred.
 */
const reported = new Set<string>();

function relay(event: string, payload: Payload): void {
  try {
    spawnSync(RELAY, ["--agent", AGENT, event], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: BUDGET_MS,
      windowsHide: true,
    });
    // Anything the relay said, or failed to say, is its own business: the island
    // is a second screen, never a dependency.
  } catch {
    /* a missing relay must not disturb the session */
  }
}

/** Once per id, and never more than a bounded number of ids. */
function firstTime(key: string | undefined): boolean {
  if (!key) return false;
  if (reported.has(key)) return false;
  if (reported.size > 500) reported.clear();
  reported.add(key);
  return true;
}

export const Montes = async ({ worktree }: { worktree: string }) => {
  const cwd = worktree || process.cwd();

  return {
    event: async ({ event }: { event: { type: string; properties?: any } }) => {
      const p = event?.properties ?? {};
      switch (event?.type) {
        case "session.created":
          reported.clear();
          relay("SessionStart", {
            cwd,
            session_id: p.info?.id,
            prompt: p.info?.title,
          });
          break;

        // The user's own words, once the text part exists. Not message.updated:
        // that one fires again for every chunk of the reply as well.
        case "message.part.updated":
        case "message.part.removed": {
          if (p.part?.type !== "text") break;
          const text = String(p.part.text ?? "").trim();
          if (!text || !firstTime(p.part.messageID)) break;
          relay("UserPromptSubmit", {
            cwd,
            session_id: p.part.sessionID,
            prompt: text.slice(0, 2000),
          });
          break;
        }

        case "tool.execute.before":
          relay("PreToolUse", {
            cwd,
            session_id: p.sessionID,
            tool_name: p.tool,
            tool_input: p.args ?? {},
          });
          break;

        case "tool.execute.after":
          relay("PostToolUse", {
            cwd,
            session_id: p.sessionID,
            tool_name: p.tool,
          });
          break;

        // opencode can see this ask but has no API for answering it, so it is a
        // badge on the pill: "bash needs permission?" — answered in the terminal
        // opencode is already waiting in.
        case "permission.asked":
          relay("Notification", {
            cwd,
            session_id: p.sessionID,
            message: `${p.tool ?? "opencode"} needs permission?`,
          });
          break;

        case "session.idle":
          relay("Stop", { cwd, session_id: p.sessionID });
          break;

        case "session.error":
          relay("StopFailure", {
            cwd,
            session_id: p.sessionID,
            message: String(p.error?.data?.message ?? p.error?.name ?? "error").slice(0, 500),
          });
          break;

        case "session.deleted":
          reported.clear();
          relay("SessionEnd", { cwd, session_id: p.info?.id });
          break;

        default:
          break;
      }
    },
  };
};

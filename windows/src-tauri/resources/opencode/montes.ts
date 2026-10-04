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
//
// Works on both plugin APIs. V2 reads the default export's id and setup(); V1
// 1.18.29+ reads server() and its returned hooks. The two are independent
// implementations of the same dispatch table — see the V1 to V2 plugin guide,
// "Support V1 and V2 from one package".

import { spawnSync } from "node:child_process"

// Replaced with the relay's absolute path when Montes writes this file. It
// arrives with forward slashes on purpose: a Windows path in a double-quoted JS
// string is full of escapes ("\b" is a backspace), and spawnSync accepts "/"
// on Windows.
const RELAY = "__MONTES_RELAY__";
// The pill this session owns. `^[a-z0-9-]{1,24}$` and not "claude", or the app
// routes the event to the Claude Code pill instead.
const AGENT = "opencode";
/** Only a permission card waits for a human; it is worth the full budget. */
const CARD_BUDGET_MS = 2000;
/**
 * Everything else is a state update for a pill nobody is looking at. The relay
 * runs synchronously so the pill cannot reorder its own states, so this budget is
 * paid on the caller's thread — once per prompt and twice per tool call. Keep it
 * short: a missing relay costs milliseconds, not a visible pause.
 */
const PILL_BUDGET_MS = 300;

type Payload = Record<string, unknown>;

/**
 * opencode re-emits a message as it streams, so the prompt would otherwise be
 * reported once per token. Remembering the message ids we have already sent is
 * what makes "the user asked something" one event instead of a hundred.
 */
const reported = new Set<string>();

function relay(event: string, payload: Payload, budget: number = PILL_BUDGET_MS): void {
  try {
    spawnSync(RELAY, ["--agent", AGENT, event], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: budget,
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

/** The user's own words, reported once per message. */
function submit(cwd: string, sessionID: string | undefined, id: string | undefined, text: string): void {
  const body = text.trim();
  if (!body || !firstTime(id)) return;
  relay("UserPromptSubmit", {
    cwd,
    session_id: sessionID,
    prompt: body.slice(0, 2000),
  });
}

/** Everything both APIs agree on: the server's public event stream. */
function dispatch(event: { type?: string; properties?: unknown }, cwd: string): void {
  const p = (event.properties ?? {}) as Record<string, any>;
  switch (event.type) {
    case "session.created":
      reported.clear();
      // V2 publishes a flat payload; V1 nests the session under `info`.
      relay("SessionStart", {
        cwd,
        session_id: p.sessionID ?? p.info?.id,
        prompt: p.title ?? p.info?.title,
      });
      break;

    // opencode can see this ask but has no API for answering it, so it is a
    // badge on the pill: "bash needs permission?" — answered in the terminal
    // opencode is already waiting in.
    case "permission.asked":
      relay(
        "Notification",
        {
          cwd,
          session_id: p.sessionID,
          message: `${p.action ?? p.source?.id ?? "opencode"} needs permission?`,
        },
        CARD_BUDGET_MS,
      );
      break;

    case "session.idle":
      relay("Stop", { cwd, session_id: p.sessionID });
      break;

    case "session.error":
      relay("StopFailure", {
        cwd,
        session_id: p.sessionID,
        message: String(p.error?.message ?? p.error?.type ?? "error").slice(0, 500),
      });
      break;

    case "session.deleted":
      reported.clear();
      relay("SessionEnd", { cwd, session_id: p.sessionID ?? p.info?.id });
      break;

    default:
      break;
  }
}

// V2 -----------------------------------------------------------------------

export default {
  id: "montes",

  setup(ctx: any) {
    // The location the plugin loaded in. Not necessarily the session's own
    // directory, but it is what routes these events to this instance's pill.
    const cwd = ctx.location.directory || process.cwd();

    // Registration failure must not take the plugin (and with it, the other
    // pills' bookkeeping) down: the pill is a convenience, not a feature gate.
    // These stay promises — they are only unwrapped in the cleanup below.
    type Registration = { dispose(): Promise<void> };
    const registrations: Promise<Registration | undefined>[] = [
      // Once during admission, before attachment and skill resolution — the
      // user's own words, and not the model's reply, which the old
      // message.part sniff could not tell apart.
      ctx.session
        .hook("prompt", (event: any) => {
          submit(cwd, event.sessionID, event.messageID, String(event.prompt?.text ?? ""));
        })
        .catch(() => undefined),
      ctx.tool
        .hook("execute.before", (event: any) => {
          relay("PreToolUse", {
            cwd,
            session_id: event.sessionID,
            tool_name: event.tool,
            tool_input: event.input ?? {},
          });
        })
        .catch(() => undefined),
      ctx.tool
        .hook("execute.after", (event: any) => {
          relay("PostToolUse", {
            cwd,
            session_id: event.sessionID,
            tool_name: event.tool,
          });
        })
        .catch(() => undefined),
    ];

    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          dispatch(event, cwd);
        }
      } catch {
        /* a closed stream is a normal shutdown, not a failure */
      }
    })();

    return async () => {
      controller.abort();
      // Unwrap first: registrations are promises, and dispose() on a promise is
      // a silent no-op that would leave every hook live after a reload.
      const settled = await Promise.allSettled(registrations);
      await Promise.allSettled(
        settled.map((r) => (r.status === "fulfilled" ? r.value?.dispose() : undefined)),
      );
    };
  },

  // V1 ---------------------------------------------------------------------
  // Unused by V2. V1 has no prompt hook, so it sniffs the message stream the way
  // this plugin always did; V1 also exposes the tool states as hooks, not events.
  async server({ worktree, directory }: { worktree?: string; directory?: string } = {}) {
    const cwd = worktree || directory || process.cwd();

    return {
      event: async ({ event }: { event: { type?: string; properties?: any } }) => {
        const p = event?.properties ?? {};
        // message.part.updated also fires for the model's own text, which V1
        // gives us no way to exclude; the relay ignores a duplicate pill state.
        if (event.type === "message.part.updated" && p.part?.type === "text") {
          submit(cwd, p.part.sessionID, p.part.messageID, String(p.part.text ?? ""));
          return;
        }
        dispatch(event, cwd);
      },
      "tool.execute.before": async (input: any, output: any) => {
        relay("PreToolUse", {
          cwd,
          session_id: input.sessionID,
          tool_name: input.tool,
          tool_input: output?.args ?? {},
        });
      },
      "tool.execute.after": async (input: any) => {
        relay("PostToolUse", { cwd, session_id: input.sessionID, tool_name: input.tool });
      },
    };
  },
};
// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Agent, Settings, WindowShot } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[montes] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** False where the OS has no global cursor (Wayland): see Island.followPageCursor. */
  cursorPoll: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Montes\montes.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  // ── Extra agents ──────────────────────────────────────────────────────────
  /** The events an agent may report, approval requests included. */
  agentEvents: () => call<string[]>("agent_events"),
  agentStatus: (agent: Agent) => call<HookStatus>("agent_status", { agent }),
  agentPreview: (agent: Agent, install: boolean) =>
    callOrThrow<HookPreview>("agent_preview", { agent, install }),
  agentApply: (agent: Agent, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agent_apply", { agent, install, fingerprint }),

  // ── opencode ───────────────────────────────────────────────────────────────
  opencodeStatus: () => call<OpencodeStatus>("opencode_status"),
  opencodePreview: (install: boolean) =>
    callOrThrow<HookPreview>("opencode_preview", { install }),
  opencodeApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("opencode_apply", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** The island's card is up — until this lands, the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** Nothing can answer — so Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /**
   * Who would answer right now, and why. Rust owns the rule; the settings show
   * its answer rather than repeating it.
   */
  chatProvider: () => callOrThrow<ResolvedProvider>("chat_provider"),
  /**
   * What Ollama has installed at `url`, and whether each model can look at a
   * picture. `url` defaults to the saved one, and is passed as typed so an
   * address can be tried before it is saved.
   */
  ollamaModels: (url?: string) =>
    callOrThrow<OllamaModelInfo[]>("ollama_models", { url: url ?? null }),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /**
   * Asks Rust to draw a window into an off-screen bitmap. Returns the raw
   * `capture_window` payload — read it with `decodeShot`.
   */
  captureWindow: (hwnd: number) => callOrThrow<ArrayBuffer>("capture_window", { hwnd }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | {
      kind: "window";
      appName: string;
      title: string;
      url?: string;
      /** Base64 PNG — what actually lets the model read the window. */
      image?: string;
    };

/** Which back end the chat is on, and whether the user chose it. */
export interface ResolvedProvider {
  provider: "claude" | "ollama";
  automatic: boolean;
  /** Why that one, spelled out by Rust. */
  note: string;
}

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  /** False for a text-only model — the common case, and why a dropped window
   *  cannot be read by it. */
  vision: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

/**
 * Unpacks the `capture_window` payload: a little-endian u32 header length, that
 * many bytes of JSON, then RGBA rows with nothing between them.
 *
 * Split this way rather than shipping an object of numbers because a screenshot is
 * a few hundred thousand bytes and JSON would spell them out as millions — an
 * `invoke` that stalls the island for a second on every window drop.
 */
export function decodeShot(payload: ArrayBuffer): WindowShot {
  const headerLen = new DataView(payload).getUint32(0, true);
  const meta = JSON.parse(
    new TextDecoder().decode(new Uint8Array(payload, 4, headerLen)),
  ) as { title: string; className: string; width: number; height: number };

  // A copy, because the transferred buffer is detached from here on and
  // ImageData will not take a view onto somebody else's memory.
  const pixels = new Uint8ClampedArray(new Uint8Array(payload, 4 + headerLen));
  if (pixels.length !== meta.width * meta.height * 4) {
    throw new Error("the captured window came back truncated");
  }
  return { ...meta, pixels };
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

export interface OpencodeStatus {
  /** True only when *this build's* plugin is the file that is there. */
  installed: boolean;
  /** A file is in the way and is not ours: never edited, never deleted. */
  foreign: boolean;
  pluginPath: string;
  hookPath: string;
  hookReady: boolean;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Montes");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

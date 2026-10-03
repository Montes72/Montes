// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus, type OllamaModelInfo, type OpencodeStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Agent, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── Claude Code section ───────────────────────────────────────────────────────

function claudeSection(status: HookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: "Claude Code" })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: "Claude Code" }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? "Montes is hooked into your Claude Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there."
          : "Install the hooks to see your Claude Code sessions in the island and approve permissions without leaving what you are doing.",
      }),
      h("div", { class: "row" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "montes-hook.exe is not in place yet. Restart Montes; if it still fails, build it with `cargo build -p montes-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? "Reinstall hooks…" : "Install hooks…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "The relay isn't installed yet.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall hooks…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.hooksPreview(install);
    } catch (err) {
      // An unreadable or invalid settings.json stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change in your settings.json. Your own hooks are left untouched."
          : "This removes Montes's entries only. Your own hooks are left untouched.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Backup → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. Open a new Claude Code session to pick the hooks up.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── Agents section ────────────────────────────────────────────────────────────
//
// Extra agents share the Claude Code relay: each one gets its own JSON hook
// config — any tool whose hooks can run `montes-hook.exe --agent <name> <Event>`
// shows up as its own pill. Writing follows the same contract as the Claude
// hooks: dated backup, diff, explicit click, fingerprint.

const AGENT_NAME_RE = /^[a-z0-9-]{1,24}$/;
const AGENT_DEFAULT_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse",
  "PostToolUse", "Stop", "SessionEnd",
];

function agentsSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, h("span", { text: "Agents" })), body);
  let eventNames: string[] = [];

  async function draw() {
    clear(body);
    if (eventNames.length === 0) eventNames = (await Bridge.agentEvents()) ?? [];

    body.append(h("div", {
      class: "hint",
      text: "Points any tool that can run a hook command at the montes-hook relay. Each agent gets its own pill: Montes writes “montes-hook.exe --agent <name> <Event>” into the tool's own JSON hook config, with the same backup and diff as the Claude Code hooks.",
    }));
    if (eventNames.length === 0) {
      body.append(h("div", {
        class: "notice warn",
        text: "The relay isn't in place yet. Restart Montes; if it still fails, build it with `cargo build -p montes-hook`.",
      }));
    }

    for (const agent of settings.agents) body.append(agentCard(agent));
    body.append(opencodeCard());
    body.append(addForm());
  }

  /**
   * opencode is not a JSON hook config to merge into — it loads plugins from
   * files — so it gets its own block and its own install path rather than being
   * squeezed into the generic form above.
   */
  function opencodeCard(): HTMLElement {
    const dot = statusDot(false);
    const statusText = h("span", { class: "hint", text: "Checking…" });
    const install = h("button", { class: "primary", text: "Install…" });
    const uninstall = h("button", { class: "danger", text: "Uninstall…" });
    let state: OpencodeStatus | null = null;

    install.addEventListener("click", () => void showOpencodePreview(true));
    uninstall.addEventListener("click", () => void showOpencodePreview(false));

    async function refresh() {
      state = await Bridge.opencodeStatus();
      dot.style.background = state?.installed ? "#22c55e" : "#f4505e";
      if (!state) statusText.textContent = "Could not ask the app about it.";
      else if (state.foreign) {
        statusText.textContent = `There is a file at ${state.pluginPath} that Montes did not write. It is left alone — move it aside if you want ours there.`;
      } else if (state.installed) {
        statusText.textContent = `Plugin in place at ${state.pluginPath}.`;
      } else {
        statusText.textContent = state?.hookReady
          ? `Not installed. It goes to ${state.pluginPath}.`
          : "The relay is missing, so nothing would reach Montes. Reinstall Montes first.";
      }
      const has = state?.installed || state?.foreign;
      uninstall.style.display = has ? "" : "none";
      install.textContent = state?.installed ? "Reinstall…" : "Install…";
      install.style.display = state?.foreign ? "none" : "";
    }
    void refresh();

    return h("div", {
      style: "display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid rgba(255,255,255,.08)",
    },
      h("div", { style: "display:flex;align-items:center;gap:8px" }, dot,
        h("span", { style: "font-weight:600", text: "opencode" })),
      h("div", {
        class: "hint",
        text: "Writes a small plugin into opencode's plugins directory, so an opencode session gets its own pill: thinking, working, finished. Its permission asks arrive as a badge rather than an Allow / Deny card — opencode's plugin API can see a request but cannot answer one, so a card would never reach the tool.",
      }),
      h("div", { style: "display:flex;gap:8px" }, install, uninstall),
      statusText,
    );
  }

  /** Same look-before-you-write flow as every other file this app touches. */
  async function showOpencodePreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.opencodePreview(install);
    } catch (err) {
      showError(String(err).replace(/^Error:\s*/, ""));
      return;
    }
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? `This is exactly what will be written to ${preview.settingsPath}. It is the whole plugin — read it, because it runs inside opencode.`
          : `This removes ${preview.settingsPath} and nothing else.`,
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${preview.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.opencodeApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: install
            ? `Done. Previous file saved as ${backup}. Start a new opencode session — it loads plugins at startup.`
            : `Done. Previous file saved as ${backup}.`,
        }));
        window.setTimeout(() => { clear(body); void draw(); }, 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel", onclick: () => { clear(body); void draw(); },
    })));
  }

  function showError(message: string) {
    clear(body);
    body.append(
      h("div", { class: "notice err", text: message }),
      h("div", { class: "row" }, h("button", {
        text: "Back", onclick: () => { clear(body); void draw(); },
      })),
    );
  }

  function eventPicker(chosen: Set<string>, onChange: (event: string, on: boolean) => void): HTMLElement {
    const box = h("div", { style: "display:flex;flex-wrap:wrap;gap:10px 14px" });
    for (const name of eventNames) {
      const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = chosen.has(name);
      cb.addEventListener("change", () => onChange(name, cb.checked));
      box.append(h("label", { style: "display:flex;align-items:center;gap:5px;font-size:12px" },
        cb, h("span", { text: name })));
    }
    return box;
  }

  function agentCard(agent: Agent): HTMLElement {
    const dot = statusDot(false);
    const statusText = h("span", { class: "hint", text: "Checking…" });
    const install = h("button", { class: "primary", text: "Install…" });
    const uninstall = h("button", { class: "danger", text: "Uninstall…" });
    const remove = h("button", { class: "danger", text: "Delete" });
    let installed = false;

    const path = h("input", {
      type: "text", spellcheck: "false", autocomplete: "off",
      style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;
    path.value = agent.path;
    path.addEventListener("change", () => {
      agent.path = path.value.trim();
      void save();
      void refreshStatus();
    });

    const wrap = h("div", {
      style: "display:flex;flex-direction:column;gap:8px;padding:10px 0;border-top:1px solid rgba(255,255,255,.08)",
    },
      h("div", { style: "display:flex;align-items:center;gap:8px" }, dot,
        h("span", { style: "font-weight:600", text: agent.name })),
      h("div", { class: "row" }, h("label", { text: "Config" }), path),
      h("div", { class: "hint", text: "Events" }),
      eventPicker(new Set(agent.events), (name, on) => {
        agent.events = on
          ? [...agent.events.filter((e) => e !== name), name]
          : agent.events.filter((e) => e !== name);
        void save();
      }),
      h("div", { class: "row" }, install, uninstall, remove),
      statusText,
    );

    async function refreshStatus() {
      const status = await Bridge.agentStatus(agent);
      installed = status?.installed ?? false;
      dot.style.background = installed ? "#22c55e" : "#f4505e";
      statusText.textContent = installed
        ? `Hooked into ${status?.settingsPath || agent.path}.`
        : "No hooks installed for this agent yet.";
      uninstall.style.display = installed ? "" : "none";
      install.textContent = installed ? "Reinstall…" : "Install…";
    }
    void refreshStatus();

    install.addEventListener("click", () => void showPreview(agent, true));
    uninstall.addEventListener("click", () => void showPreview(agent, false));
    remove.addEventListener("click", async () => {
      if (installed) {
        // Never leave hooks behind in a file nobody can reach any more.
        await showPreview(agent, false, () => {
          settings.agents = settings.agents.filter((a) => a !== agent);
        });
        return;
      }
      settings.agents = settings.agents.filter((a) => a !== agent);
      await save();
      void draw();
    });
    return wrap;
  }

  function addForm(): HTMLElement {
    const name = h("input", {
      type: "text", placeholder: "my-agent", spellcheck: "false", autocomplete: "off",
      style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;
    const path = h("input", {
      type: "text", placeholder: "C:\\Users\\you\\.gemini\\settings.json",
      spellcheck: "false", autocomplete: "off", style: "flex:1 1 auto;min-width:0",
    }) as HTMLInputElement;
    const chosen = new Set(AGENT_DEFAULT_EVENTS.filter((e) => eventNames.includes(e)));
    const error = h("div", {});
    const add = h("button", { class: "primary", text: "Add agent" });

    add.addEventListener("click", async () => {
      clear(error);
      const n = name.value.trim();
      if (!AGENT_NAME_RE.test(n)) {
        error.append(h("div", { class: "notice err", text: "Use 1–24 lowercase letters, digits or hyphens." }));
        return;
      }
      if (n === "claude") {
        error.append(h("div", { class: "notice err", text: "“claude” is reserved for the Claude Code pill." }));
        return;
      }
      if (settings.agents.some((a) => a.name === n)) {
        error.append(h("div", { class: "notice err", text: "That name is already used." }));
        return;
      }
      const p = path.value.trim();
      if (!p) {
        error.append(h("div", { class: "notice err", text: "Give the full path to the tool's JSON hook config." }));
        return;
      }
      settings.agents = [...settings.agents, { name: n, path: p, events: [...chosen] }];
      await save();
      void draw();
    });

    return h("div", {
      style: "display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)",
    },
      h("div", { class: "hint", text: "Add an agent" }),
      h("div", { class: "row" }, h("label", { text: "Name" }), name),
      h("div", { class: "row" }, h("label", { text: "Config" }), path),
      eventPicker(chosen, (event, on) => {
        if (on) chosen.add(event); else chosen.delete(event);
      }),
      h("div", { class: "row" }, add),
      error,
    );
  }

  async function showPreview(agent: Agent, install: boolean, onDone?: () => void) {
    let preview;
    try {
      preview = await Bridge.agentPreview(agent, install);
    } catch (err) {
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back", onclick: () => { clear(body); void draw(); },
        })),
      );
      return;
    }
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? `This is exactly what will change in ${preview.settingsPath}. Other hooks in that file are left untouched.`
          : `This removes ${agent.name}'s entries only. Other hooks are left untouched.`,
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${preview.backup}` })),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.agentApply(agent, install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: install
            ? `Done. Previous settings saved as ${backup}. Start a new ${agent.name} session to pick the hooks up.`
            : `Done. Previous settings saved as ${backup}.`,
        }));
        if (onDone) {
          onDone();
          await save();
        }
        window.setTimeout(() => { clear(body); void draw(); }, 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel", onclick: () => { clear(body); void draw(); },
    })));
  }

  void draw();
  return section;
}

// ── Claude API section ────────────────────────────────────────────────────────

const MODELS: [string, string][] = [
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
];

function apiSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint", text: hasKey ? "Key saved in the Windows Credential Manager." : "No key yet — the chat needs one." });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (stored)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Key saved in the Windows Credential Manager."
      : "No key yet — the chat needs one.";
    field.placeholder = present ? "••••••••••••  (stored)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  const model = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of MODELS) model.append(h("option", { value: id, text: label }));
  if (!MODELS.some(([id]) => id === settings.model)) {
    model.append(h("option", { value: settings.model, text: settings.model }));
  }
  model.value = settings.model;
  model.addEventListener("change", () => {
    settings.model = model.value;
    void save();
  });

  clearBtn.style.display = hasKey ? "" : "none";

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Claude" })),
    state,
    h("div", { class: "row" }, h("label", { text: "API key" }), field, saveBtn, clearBtn),
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    feedback,
  );
}

// ── Assistant section ─────────────────────────────────────────────────────────
//
// Which back end answers the chat. Rust owns the rule — an API key means Claude,
// no key means Ollama — and this section shows its answer rather than repeating
// it, so "automatic" can never quietly disagree with the app.

const PROVIDERS: [Settings["provider"], string][] = [
  ["auto", "Automatic — Claude with a key, Ollama without"],
  ["claude", "Claude (Anthropic API)"],
  ["ollama", "Ollama (on this machine)"],
];

function gb(sizeBytes: number): string {
  if (!sizeBytes) return "";
  const gb = sizeBytes / 1024 ** 3;
  return gb >= 1 ? ` · ${gb.toFixed(1)} GB` : ` · ${Math.round(sizeBytes / 1024 ** 2)} MB`;
}

function assistantSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, h("span", { text: "Assistant" })), body);
  const verdict = h("div", { class: "hint" });

  const pick = h("select", { style: "flex:1 1 auto;min-width:0" }) as HTMLSelectElement;
  for (const [value, label] of PROVIDERS) pick.append(h("option", { value, text: label }));
  pick.value = settings.provider;
  pick.addEventListener("change", () => {
    settings.provider = pick.value as Settings["provider"];
    void save().then(draw);
  });

  const url = h("input", {
    type: "text", spellcheck: "false", autocomplete: "off",
    placeholder: "http://localhost:11434",
    style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  url.value = settings.ollamaUrl;
  url.addEventListener("change", () => {
    settings.ollamaUrl = url.value.trim();
    void save().then(draw);
  });

  const model = h("select", { style: "flex:1 1 auto;min-width:0" }) as HTMLSelectElement;
  const scan = h("button", { text: "Find models" });
  const modelsHint = h("div", { class: "hint" });
  let models: OllamaModelInfo[] = [];
  /** The list is asked for once by itself; the button is for asking again. */
  let scanned = false;
  /**
   * True only once a listing has actually arrived. Before that, calling a model
   * "not installed" would be a guess — the honest word is that nobody has looked.
   */
  let listed = false;

  model.addEventListener("change", () => {
    settings.ollamaModel = model.value;
    void save();
    fillModelOptions();
  });

  function fillModelOptions() {
    clear(model);
    const chosen = settings.ollamaModel;
    for (const m of models) {
      model.append(h("option", {
        value: m.name,
        text: `${m.name}${m.vision ? " · sees pictures" : " · text only"}${gb(m.sizeBytes)}`,
      }));
    }
    // A model that is configured but not installed still has to be selectable:
    // it may be pulled while Montes is closed, and hiding it would leave the
    // settings lying about what is configured.
    if (chosen && !models.some((m) => m.name === chosen)) {
      model.append(h("option", {
        value: chosen,
        text: listed ? `${chosen} · not installed` : chosen,
      }));
    }
    model.value = chosen;
    model.disabled = models.length === 0;
  }

  async function findModels() {
    scan.disabled = true;
    clear(modelsHint);
    modelsHint.textContent = `Asking ${url.value.trim() || settings.ollamaUrl}…`;
    try {
      const found = await Bridge.ollamaModels(url.value.trim());
      models = Array.isArray(found) ? found : [];
      listed = true;
      fillModelOptions();
      modelsHint.textContent = models.length
        ? `${models.length} model${models.length === 1 ? "" : "s"} installed. A text-only model cannot read a window you drop on the island.`
        : "Ollama is answering, but nothing is installed. Pull one with `ollama pull qwen3:14b`.";
    } catch (err) {
      models = [];
      listed = false;
      fillModelOptions();
      modelsHint.textContent = "";
      modelsHint.append(h("div", {
        class: "notice warn",
        text: `Could not reach Ollama: ${String(err).replace(/^Error:\s*/, "")}`,
      }));
    } finally {
      scan.disabled = false;
    }
  }
  scan.addEventListener("click", () => void findModels());
  fillModelOptions();

  async function draw() {
    pick.value = settings.provider;
    url.value = settings.ollamaUrl;
    const local = settings.provider === "ollama" || settings.provider === "auto";

    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: "With no choice made, a saved API key means Claude and no key means the model on this machine — so the chat works on a fresh install instead of asking for money.",
      }),
      h("div", { class: "row" }, h("label", { text: "Answers" }), pick),
    );

    if (local) {
      body.append(
        h("div", { class: "row" }, h("label", { text: "Ollama at" }), url, scan),
        h("div", { class: "row" }, h("label", { text: "Model" }), model),
        modelsHint,
      );
      // Ollama answers on the loopback interface in milliseconds, so showing an
      // empty, disabled dropdown and waiting to be asked would be the app making
      // the user do its work.
      if (!scanned) {
        scanned = true;
        void findModels();
      }
    }

    // What would actually answer, as Rust decides it. An error here is the useful
    // case: it is the sentence the island would show if you asked right now.
    clear(verdict);
    try {
      const resolved = await Bridge.chatProvider();
      // A missing answer is not an answer: showing the reason is the whole point
      // of this line, so a null has to read as "nothing can answer" and not as an
      // empty success.
      if (!resolved) throw new Error("Nothing to answer right now.");
      verdict.append(h("div", {
        class: "notice ok",
        text: `${resolved.automatic ? "Automatic" : "Pinned"}: ${resolved.note}`,
      }));
    } catch (err) {
      verdict.append(h("div", {
        class: "notice warn",
        text: String(err).replace(/^Error:\s*/, ""),
      }));
    }
    body.append(verdict);
  }

  void draw();
  return section;
}

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Pick up to ${MAX_ACTIVE} pills to show next to Montes — ${used}/${MAX_ACTIVE} in use. Keys are stored in the Windows Credential Manager, never on disk.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Save" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
      );
    }

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Montes" }), h("span", { class: "version", text: version })),
    claudeSection(status),
    agentsSection(),
    apiSection(hasKey),
    assistantSection(),
    integrationsSection(present),
    generalSection(),
    h("div", {
      class: "hint",
      text: "No telemetry. Network requests only go to the services you configure yourself.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();

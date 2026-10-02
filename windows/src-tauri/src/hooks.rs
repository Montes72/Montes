// Claude Code hook installation.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read %USERPROFILE%\.claude\settings.json, take a dated backup, merge without
// touching anybody else's hooks, show the diff, and write only after an explicit
// click. Uninstall removes Montes's entries and nothing else.
//
// The command is only the quoted exe path in forward slashes plus the event name:
// on Windows Claude Code runs hook commands through Git Bash, and anything with
// PowerShell or cmd in it breaks.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use crate::{platform, settings};

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
];

/// The events a third-party agent may report. `PermissionRequest` is left out:
/// approval cards only work for Claude Code — an external agent's request is
/// answered immediately with no decision and it re-asks in its terminal.
pub fn agent_events() -> Vec<&'static str> {
    HOOK_EVENTS
        .iter()
        .filter(|(event, _)| *event != "PermissionRequest")
        .map(|(event, _)| *event)
        .collect()
}

/// Marker that identifies a Montes entry inside settings.json.
const MARKER: &str = "montes-hook";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    /// Identifies the bytes this diff was computed from; handed back to `write`
    /// so we only ever apply what the user actually looked at.
    pub fingerprint: String,
}

pub fn settings_path() -> PathBuf {
    platform::home_dir().join(".claude").join("settings.json")
}

/// Reads `~/.claude/settings.json`.
///
/// The only error that means "start from nothing" is the file not being there.
/// Everything else — a lock held by another process, a permission problem, JSON
/// we cannot parse — is reported, because the alternative is treating somebody's
/// unreadable settings as an empty object and then writing that back over them.
fn read_settings_at(path: &Path) -> Result<Value, String> {
    match std::fs::read(path) {
        Ok(bytes) => parse_settings(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        // A lock, a permission problem, a bad drive: all of them mean we do not
        // know what is in there, and not knowing is not the same as empty.
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

/// The parsing half of `read_settings_at`, split out so it can be tested without
/// a home directory.
fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{path} isn't a JSON object — Montes won't touch it.")),
        Err(err) => Err(format!(
            "{path} isn't valid JSON ({err}). Fix or move it, then try again — Montes won't overwrite it."
        )),
    }
}

/// The settings as they are, or an empty object when we cannot tell. Only for
/// read-only paths like `status()`, which must never fail loudly; anything that
/// writes uses `read_settings_at()` and surfaces the error instead.
fn read_settings_lossy_at(path: &Path) -> Value {
    read_settings_at(path).unwrap_or_else(|_| json!({}))
}

fn hook_command(event: &str, agent: Option<&str>) -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    match agent {
        // The relay tags the payload with `montes_agent`, so the island routes
        // the event to this agent's own pill instead of Claude Code's.
        Some(name) => format!("\"{exe}\" --agent {name} {event}"),
        None => format!("\"{exe}\" {event}"),
    }
}

/// True when a hook command is a Montes relay command of the given kind:
/// Claude Code's own set (`agent = None`) or one named agent's set.
///
/// The agent test keeps the trailing space, so `--agent foo` does not also match
/// `--agent foobar`.
fn command_is_ours(command: &str, agent: Option<&str>) -> bool {
    if !command.contains(MARKER) {
        return false;
    }
    match agent {
        None => !command.contains("--agent "),
        Some(name) => command.contains(&format!("--agent {name} ")),
    }
}

fn entry_is_ours(entry: &Value, agent: Option<&str>) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .map(|c| command_is_ours(c, agent))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Settings with this kind's hooks added; everything else is left untouched.
///
/// `install` lists the events to write. Entries of this kind on any *other*
/// event are removed, so re-installing after unticking an event cleans it up,
/// and entries left by an older install are cleared too.
fn merged_at(existing: &Value, agent: Option<&str>, install: &[&str]) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);

    for (event, timeout) in HOOK_EVENTS {
        let mut list = hooks
            .get(*event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry, agent));
        if install.contains(event) {
            list.push(json!({
                "hooks": [{
                    "type": "command",
                    "command": hook_command(event, agent),
                    "timeout": timeout,
                }]
            }));
        }
        if list.is_empty() {
            hooks.remove(*event);
        } else {
            hooks.insert((*event).to_string(), Value::Array(list));
        }
    }

    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// Settings with this kind's entries removed, and nothing else changed.
fn without_ours_at(existing: &Value, agent: Option<&str>) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> =
                    list.iter().filter(|e| !entry_is_ours(e, agent)).cloned().collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup.
fn stamp() -> String {
    let t = platform::local_time();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    )
}

/// A dated backup beside the target, keeping its own file name.
fn backup_path_at(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("settings.json");
    path.with_file_name(format!("{name}.bak-{}", stamp()))
}

/// Identifies the exact bytes a preview was computed from. FNV-1a is plenty:
/// the question is only "is this still the file I showed the user?".
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint_at(path: &Path) -> String {
    match std::fs::read(path) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

fn status_at(path: &Path, agent: Option<&str>) -> HookStatus {
    let current = read_settings_lossy_at(path);
    let installed = current
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| {
            hooks
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .any(|entry| entry_is_ours(entry, agent))
        })
        .unwrap_or(false);
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed,
        settings_path: path.to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

pub fn status() -> HookStatus {
    status_at(&settings_path(), None)
}

/// The events Claude Code gets: all of them.
fn claude_events() -> Vec<&'static str> {
    HOOK_EVENTS.iter().map(|(event, _)| *event).collect()
}

/// The target file of an agent install, validated: a real agent name and an
/// absolute path. A relative path would resolve against the app's working
/// directory and write somewhere nobody can find again.
fn agent_config_path(agent: &crate::settings::Agent) -> Result<std::path::PathBuf, String> {
    let name = agent.name.trim();
    let name_ok = !name.is_empty()
        && name.len() <= 24
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !name_ok {
        return Err("The agent name must be 1–24 characters of a–z, 0–9 and -.".into());
    }
    if name == "claude" {
        return Err("\"claude\" is reserved for the Claude Code pill.".into());
    }
    let raw = agent.path.trim();
    let path = std::path::PathBuf::from(raw);
    if raw.is_empty() || !path.is_absolute() {
        return Err("Give the full path to the tool's JSON hook config.".into());
    }
    Ok(path)
}

fn preview_at(
    path: &Path,
    agent: Option<&str>,
    install_events: &[&str],
    install: bool,
) -> Result<HookPreview, String> {
    let current = read_settings_at(path)?;
    let next = if install {
        merged_at(&current, agent, install_events)
    } else {
        without_ours_at(&current, agent)
    };
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path_at(path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: current_fingerprint_at(path),
    })
}

pub fn preview(install: bool) -> Result<HookPreview, String> {
    preview_at(&settings_path(), None, &claude_events(), install)
}

/// Preview of what installing (or removing) one agent's hooks would change in
/// that agent's own config file.
pub fn agent_preview(
    agent: &crate::settings::Agent,
    install: bool,
) -> Result<HookPreview, String> {
    let path = agent_config_path(agent)?;
    let events: Vec<&str> = agent.events.iter().map(String::as_str).collect();
    preview_at(&path, Some(&agent.name), &events, install)
}

/// Status of one agent's entries in its own config file.
pub fn agent_status(agent: &crate::settings::Agent) -> HookStatus {
    match agent_config_path(agent) {
        Ok(path) => status_at(&path, Some(&agent.name)),
        // An invalid entry reads as "not installed", so the UI can still show it
        // and let the user fix the name or the path.
        Err(_) => HookStatus {
            installed: false,
            settings_path: agent.path.clone(),
            hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
            hook_ready: settings::hook_exe_path().exists(),
        },
    }
}

/// Writes the merged (or cleaned) settings after taking a dated backup.
///
/// `fingerprint` is the one the preview was computed from. If the file changed
/// in between — another tool, another window, the user's own editor — we stop
/// and make them look at a fresh diff, because the only thing worse than not
/// installing the hooks is silently reverting somebody else's edit.
fn write_at(
    path: &Path,
    agent: Option<&str>,
    install_events: &[&str],
    install: bool,
    fingerprint: &str,
) -> Result<String, String> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Read before the backup: an unreadable file must abort before we touch
    // anything at all.
    let current = read_settings_at(path)?;
    if current_fingerprint_at(path) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    let backup = backup_path_at(path);
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }

    let next = if install {
        merged_at(&current, agent, install_events)
    } else {
        without_ours_at(&current, agent)
    };
    let mut text = pretty(&next);
    text.push('\n');

    // Write beside the target and rename over it: a crash or a full disk leaves
    // the original settings.json intact rather than half a file.
    let temp = path.with_extension(format!("json.montes-{}", std::process::id()));
    if let Err(err) = write_like(&temp, path, text.as_bytes()) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    Ok(backup.to_string_lossy().to_string())
}

pub fn write(install: bool, fingerprint: &str) -> Result<String, String> {
    write_at(&settings_path(), None, &claude_events(), install, fingerprint)
}

/// Installs (or removes) one agent's hooks in its own config file.
pub fn agent_write(
    agent: &crate::settings::Agent,
    install: bool,
    fingerprint: &str,
) -> Result<String, String> {
    let path = agent_config_path(agent)?;
    let events: Vec<&str> = agent.events.iter().map(String::as_str).collect();
    write_at(&path, Some(&agent.name), &events, install, fingerprint)
}

/// Writes `bytes` to `temp`, which is about to replace `original`. (The
/// `original` argument kept its purpose on Unix, where the new file had to be
/// given the original's permissions; on Windows it is unused.)
fn write_like(temp: &Path, original: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    let mut file = options.open(temp)?;
    file.write_all(bytes)?;
    let _ = original;
    Ok(())
}

/// Copies the relay (montes-hook.exe / montes-hook) into the local data dir's
/// bin/ on launch. In a bundled install it comes from the app resources; in
/// `tauri dev` it sits next to the app binary in the workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
    let Some(dir) = dest.parent() else { return };
    // Nobody else may swap the relay Claude Code runs: its folder is ours only.
    if platform::ensure_private_dir(&settings::local_dir()).is_err()
        || std::fs::create_dir_all(dir).is_err()
    {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve(platform::HOOK_EXE, tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed build, then `tauri dev` (target/debug) next to the
            // release hook the pre-build step produces.
            candidates.push(parent.join(platform::HOOK_EXE));
            candidates.push(parent.join("../release").join(platform::HOOK_EXE));
            // Belt and braces: where the old glob form used to land it.
            candidates.push(parent.join("_up_/target/release").join(platform::HOOK_EXE));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else {
        crate::log::line(format!(
            "{} not found — Claude Code hooks cannot work. Looked in: {}",
            platform::HOOK_EXE,
            tried.join(", ")
        ));
        return;
    };
    install_relay(&src, &dest);
}

#[cfg(windows)]
fn install_relay(src: &Path, dest: &Path) {
    let same = match (std::fs::metadata(src), std::fs::metadata(dest)) {
        (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() == b.modified().ok(),
        _ => false,
    };
    if same {
        return;
    }
    // A hook may be running right now and hold the file open; keeping the old
    // copy is fine, it is the same relay.
    if let Err(err) = stage_and_replace(src, dest) {
        if !dest.exists() {
            crate::log::line(format!("could not install {}: {err}", platform::HOOK_EXE));
        }
    }
}

/// Copies through a neighbouring temporary file and moves it into place.
///
/// A plain `fs::copy` writes straight into the destination, so a Montes that is
/// closed while it copies leaves Claude Code with a half-written relay: hooks
/// then fail in a way that looks like Montes is simply not running. Rename is
/// atomic on NTFS, so the file at `dest` is always a whole relay or still the
/// previous one.
#[cfg(windows)]
fn stage_and_replace(src: &Path, dest: &Path) -> std::io::Result<()> {
    let Some(dir) = dest.parent() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "destination has no parent",
        ));
    };
    let temp = dir.join("montes-hook.exe.new");
    std::fs::copy(src, &temp)?;
    match std::fs::rename(&temp, dest) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_file(&temp);
            Err(err)
        }
    }
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// settings.json is short, so a plain O(n·m) LCS is the simplest honest diff.
fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

    // Keep three lines of context around each change so the panel stays readable.
    let changed: Vec<usize> = out
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with('+') || l.starts_with('-'))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return "No change.".into();
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        for k in lo..hi {
            keep[k] = true;
        }
    }
    let mut result = String::new();
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHERE: &str = "settings.json";

    #[test]
    fn a_utf8_bom_is_stripped_not_treated_as_corruption() {
        // PowerShell 5's `Set-Content -Encoding utf8` produces exactly this.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"model":"opus","hooks":{}}"#);
        let parsed = parse_settings(&bytes, WHERE).expect("a BOM must not defeat the parser");
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn unreadable_content_is_an_error_never_an_empty_object() {
        // This is the whole bug: returning {} here meant `merged_at()` produced
        // a file containing nothing but Montes's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(
                parse_settings(bad, WHERE).is_err(),
                "content we cannot use must refuse, not come back empty"
            );
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(parse_settings(b"  
	 ", WHERE).unwrap(), json!({}));
    }

    #[test]
    fn merging_keeps_every_other_setting_and_every_foreign_hook() {
        let existing = serde_json::json!({
            "model": "claude-opus-5",
            "theme": "dark",
            "enabledPlugins": ["a", "b"],
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "someone-elses-tool.exe" }] }
                ],
                "SomeEventWeDoNotTouch": [
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });

        let after = merged_at(&existing, None, &claude_events());
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["enabledPlugins"], serde_json::json!(["a", "b"]));

        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("someone-elses-tool.exe")),
            "another tool's hook was dropped"
        );
        assert!(pre.iter().any(|e| entry_is_ours(e, None)), "our own hook was not added");
        assert!(after["hooks"]["SomeEventWeDoNotTouch"].is_array());

        // And removing ours puts it back exactly as it was.
        let cleaned = without_ours_at(&after, None);
        assert_eq!(cleaned, existing);
    }

    #[test]
    fn an_agents_hooks_never_collide_with_claudes_or_with_each_other() {
        let existing = serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "other.exe" }] }
                ]
            }
        });

        // Claude's set, then two agents, all in the same file.
        let with_claude = merged_at(&existing, None, &claude_events());
        let with_foo = merged_at(&with_claude, Some("foo"), &["PreToolUse", "Stop"]);
        let with_foobar = merged_at(&with_foo, Some("foobar"), &["PreToolUse"]);

        let pre = with_foobar["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| entry_is_ours(e, None)), "Claude's hook is gone");
        assert!(pre.iter().any(|e| entry_is_ours(e, Some("foo"))), "foo's hook is gone");
        assert!(
            pre.iter().any(|e| entry_is_ours(e, Some("foobar"))),
            "foobar's hook is gone"
        );
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other.exe")),
            "another tool's hook was dropped"
        );
        // `--agent foo` must not be mistaken for `--agent foobar`.
        assert!(
            !pre
                .iter()
                .filter(|e| entry_is_ours(e, Some("foo")))
                .any(|e| serde_json::to_string(e).unwrap().contains("foobar")),
            "foo and foobar were confused"
        );

        // Removing one agent leaves the others alone.
        let without_foo = without_ours_at(&with_foobar, Some("foo"));
        let pre = without_foo["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(!pre.iter().any(|e| entry_is_ours(e, Some("foo"))));
        assert!(pre.iter().any(|e| entry_is_ours(e, Some("foobar"))));
        assert!(pre.iter().any(|e| entry_is_ours(e, None)));
        // `Stop` was foo's only, so the key goes away entirely.
        assert!(without_foo["hooks"].get("Stop").is_none());

        // Unticking an event removes just that entry.
        let stop_only = merged_at(&with_foobar, Some("foobar"), &[]);
        assert!(
            stop_only["hooks"]["PreToolUse"]
                .as_array()
                .is_some_and(|p| !p.iter().any(|e| entry_is_ours(e, Some("foobar")))),
            "an unticked event must be cleaned up"
        );
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points
    /// the home directory at a temp directory, and that is process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("montes-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var(platform::HOME_VAR, &tmp);

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("montes-hook"), "the diff must show what changes");
        let backup = write(true, &plan.fingerprint).expect("install should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = write(false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("changed since the preview"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true).is_err());
        assert!(write(true, "whatever").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}

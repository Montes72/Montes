// The opencode plugin Montes installs.
//
// opencode has no hook config to merge into: it loads plugins from files in
// `~/.config/opencode/plugins/`. So instead of editing JSON, Montes ships one
// file and puts it there — under the same contract as everything else it writes
// (dated backup, diff before the write, an explicit click, and a fingerprint so
// nothing that changed underneath is silently overwritten).
//
// Everything the user may have in that file is theirs. A file that exists but
// does not look like ours is never edited and never deleted; the UI says so
// instead of pretending it installed something.
//
// Every function takes the path it works on, with the real one coming from
// `plugin_path()`, so the behaviour can be tested against a scratch file rather
// than against whatever happens to be installed on the machine running the tests.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::hooks::{
    backup_path_at, current_fingerprint_at, unified_diff, write_like, HookPreview,
};
use crate::platform;

/// The plugin as it is written, with the relay's real path in it. Including it
/// at compile time keeps it versioned with the code that talks to it; the path is
/// the only thing that can differ between two machines.
const TEMPLATE: &str = include_str!("../resources/opencode/montes.ts");

/// The relay's path is written into the file, so a build installed somewhere
/// else still points at its own relay rather than somebody else's.
const PLACEHOLDER: &str = "__MONTES_RELAY__";

/// The file name inside opencode's plugin directory. Not `montes.ts` alone:
/// `montes` is the name the app is known by, and the directory is shared with
/// plugins this app has never heard of.
const PLUGIN_FILE: &str = "montes.ts";

/// A line that can only be in a file Montes wrote.
const MARKER: &str = "montes-hook.exe";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeStatus {
    /// True only for a file that is ours *and* current, so "Installed" means
    /// "this build's plugin is in place", not "something is there".
    pub installed: bool,
    /// The file exists but is not ours: never touched, never deleted.
    pub foreign: bool,
    pub plugin_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
}

/// `OPENCODE_CONFIG_DIR` moves the whole config directory, plugins included, so a
/// plugin written in the standard place would simply never be loaded.
pub fn plugin_dir() -> PathBuf {
    match std::env::var("OPENCODE_CONFIG_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir).join("plugins"),
        _ => platform::home_dir()
            .join(".config")
            .join("opencode")
            .join("plugins"),
    }
}

pub fn plugin_path() -> PathBuf {
    plugin_dir().join(PLUGIN_FILE)
}

/// The file exactly as it will be on disk: the template with this machine's
/// relay path, and a trailing newline whatever the template happens to end with.
///
/// Status, preview and write all go through this one function, so "Installed"
/// can never disagree with what "Install" would produce — which is the kind of
/// bug that makes a status line a guess.
fn wanted(hook: &str) -> String {
    let mut text = TEMPLATE.replace(PLACEHOLDER, hook);
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

fn looks_like_ours(text: &str) -> bool {
    text.contains(MARKER)
}

fn read(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        // No file is not an error: that is what installing looks like.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("{} could not be read: {err}", path.display())),
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

pub fn status() -> OpencodeStatus {
    let hook = crate::settings::hook_exe_path();
    status_at(&plugin_path(), &hook)
}

pub fn status_at(path: &Path, hook: &Path) -> OpencodeStatus {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let exists = path.exists();
    let foreign = exists && !looks_like_ours(&text);
    OpencodeStatus {
        // A file we wrote for an older build still needs reinstalling, and saying
        // so is the difference between a status and a guess.
        installed: exists && !foreign && text == wanted(&hook.to_string_lossy()),
        foreign,
        plugin_path: path.to_string_lossy().to_string(),
        hook_path: hook.to_string_lossy().to_string(),
        hook_ready: hook.exists(),
    }
}

/// The diff the user reads before anything is written. The shape is the one the
/// Claude Code hooks use, so the window shows them the same kind of thing.
pub fn preview(install: bool) -> Result<HookPreview, String> {
    preview_at(&plugin_path(), install)
}

pub fn preview_at(path: &Path, install: bool) -> Result<HookPreview, String> {
    let current = read(path)?;
    let next = if install {
        wanted(&crate::settings::hook_exe_path().to_string_lossy())
    } else {
        String::new()
    };
    Ok(HookPreview {
        diff: unified_diff(&current, &next),
        backup: backup_path_at(path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: current_fingerprint_at(path),
    })
}

/// Writes the plugin, or takes it back out. Returns the backup it took, or an
/// empty string when there was nothing to back up.
pub fn apply(install: bool, fingerprint: &str) -> Result<String, String> {
    apply_at(&plugin_path(), install, fingerprint)
}

pub fn apply_at(path: &Path, install: bool, fingerprint: &str) -> Result<String, String> {
    let current = read(path)?;
    if current_fingerprint_at(path) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    if !install {
        if current.is_empty() {
            return Ok(String::new());
        }
        if !looks_like_ours(&current) {
            return Err(format!(
                "{} is not a Montes plugin, so it stays. Move it aside if you want it gone.",
                path.display()
            ));
        }
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(String::new()),
            Err(err) => Err(format!("could not remove it: {err}")),
        };
    }

    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let backup = backup_path_at(path);
    let taken = if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("backup failed: {e}"))?;
        backup.to_string_lossy().to_string()
    } else {
        String::new()
    };

    let text = wanted(&crate::settings::hook_exe_path().to_string_lossy());
    // Write beside the target and rename over it, like every other file this app
    // touches: a crash leaves the previous plugin in place, not half of one.
    let temp = path.with_extension(format!("ts.montes-{}", std::process::id()));
    if let Err(err) = write_like(&temp, path, text.as_bytes()) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    Ok(taken)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOOK: &str = r"C:\Users\you\AppData\Local\Montes\bin\montes-hook.exe";

    /// A scratch directory per test, removed afterwards. Two tests running at
    /// once must not see each other's file.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("montes-opencode-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory");
        dir.join(PLUGIN_FILE)
    }

    /// What a successful install leaves on disk, on this machine.
    fn installed_text() -> String {
        wanted(&crate::settings::hook_exe_path().to_string_lossy())
    }

    #[test]
    fn the_written_plugin_points_at_this_machines_relay() {
        let text = wanted(HOOK);
        assert!(text.contains(HOOK), "the relay path must be in the file");
        assert!(!text.contains(PLACEHOLDER), "the placeholder must not survive");
        assert!(looks_like_ours(&text));
    }

    #[test]
    fn the_plugin_file_is_recognisably_ours() {
        // The marker is how a later run tells its own file from somebody else's.
        assert!(looks_like_ours(&wanted(HOOK)));
        assert!(!looks_like_ours("export const Other = async () => ({})"));
        assert!(!looks_like_ours(""));
    }

    #[test]
    fn the_diff_is_a_preview_and_the_backup_sits_beside_the_target() {
        let path = PathBuf::from(r"C:\Users\you\.config\opencode\plugins\montes.ts");
        // A first install is a pure insertion: every line is a change, so there
        // is nothing to elide and the user reads the whole plugin that is about
        // to run inside their agent. That is the honest preview before a write.
        let install = unified_diff("", &wanted(HOOK));
        assert!(install.starts_with("+ // Montes"));
        assert!(install.contains("+ export const Montes"));

        // Elision is for a mixed diff, where the middle is unchanged noise.
        let edited = format!("{}\nconst UNRELATED = 1;\n", wanted(HOOK));
        let mixed = unified_diff(&wanted(HOOK), &edited);
        assert!(mixed.contains("  …"));
        assert!(!mixed.contains("+ // Montes"));

        // Removing it is the same list, the other way round.
        let remove = unified_diff(&wanted(HOOK), "");
        assert!(remove.starts_with("- // Montes"));
        // Nothing to do says so, rather than showing an empty panel.
        assert_eq!(unified_diff("same", "same"), "No change.");

        let backup = backup_path_at(&path);
        assert_eq!(backup.parent().unwrap(), path.parent().unwrap());
        let name = backup.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("montes.ts.bak-"), "got {name}");
    }

    #[test]
    fn opencode_config_dir_moves_the_target() {
        // A plugin written in the standard place would never load for somebody
        // who moved theirs, which is the quietest possible failure.
        let previous = std::env::var("OPENCODE_CONFIG_DIR").ok();
        std::env::set_var("OPENCODE_CONFIG_DIR", r"D:\elsewhere");
        assert_eq!(plugin_dir(), PathBuf::from(r"D:\elsewhere").join("plugins"));
        assert_eq!(plugin_path(), PathBuf::from(r"D:\elsewhere\plugins\montes.ts"));

        std::env::set_var("OPENCODE_CONFIG_DIR", "   ");
        assert!(plugin_dir().ends_with("plugins"));
        assert!(plugin_dir().to_string_lossy().contains("opencode"));

        match previous {
            Some(v) => std::env::set_var("OPENCODE_CONFIG_DIR", v),
            None => std::env::remove_var("OPENCODE_CONFIG_DIR"),
        }
    }

    #[test]
    fn installing_writes_the_file_and_keeps_the_old_one() {
        let path = scratch("install");
        // A first install has nothing to back up, and says so rather than
        // inventing a path to a file that does not exist.
        let preview = preview_at(&path, true).expect("preview of an absent file is fine");
        let before = preview.fingerprint.clone();
        assert!(apply_at(&path, true, &preview.fingerprint).expect("install").is_empty());

        let written = std::fs::read_to_string(&path).expect("the plugin is there");
        assert_eq!(written, installed_text());
        let status = status_at(&path, &crate::settings::hook_exe_path());
        assert!(status.installed && !status.foreign);
        assert_ne!(
            before,
            preview_at(&path, true).unwrap().fingerprint,
            "the fingerprint has to follow the file it described"
        );

        // Replacing it takes the previous version aside first.
        let preview = preview_at(&path, true).unwrap();
        let backup = apply_at(&path, true, &preview.fingerprint).expect("reinstall");
        assert!(backup.contains("montes.ts.bak-"));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), installed_text());

        // And it can be taken back out, which is the only delete we ever do.
        let preview = preview_at(&path, false).unwrap();
        assert!(preview.diff.starts_with("- // Montes"));
        apply_at(&path, false, &preview.fingerprint).expect("uninstall");
        assert!(!path.exists());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_file_that_is_not_ours_survives_both_directions() {
        let path = scratch("foreign");
        std::fs::write(&path, "export const SomeoneElse = async () => ({})\n").unwrap();

        let status = status_at(&path, Path::new(HOOK));
        assert!(status.foreign, "it is in the way and it is not ours");
        assert!(!status.installed);

        // Installing never edits it either — the UI offers no button, and even if
        // a caller tried, the fingerprint would not be one the user reviewed.
        let preview = preview_at(&path, true).unwrap();
        assert!(preview.diff.contains("- export const SomeoneElse"));

        // Removing refuses, and says why, rather than deleting somebody's plugin.
        let preview = preview_at(&path, false).unwrap();
        let err = apply_at(&path, false, &preview.fingerprint).expect_err("must refuse");
        assert!(err.contains("not a Montes plugin"), "{err}");
        assert!(path.exists(), "their file is still there");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "export const SomeoneElse = async () => ({})\n"
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_file_that_changed_under_the_diff_is_never_overwritten() {
        let path = scratch("race");
        std::fs::write(&path, "// an older plugin\n// montes-hook.exe\n").unwrap();

        let reviewed = preview_at(&path, true).unwrap();
        // Somebody edits it between the preview and the click.
        std::fs::write(&path, "// somebody else's edit\n// montes-hook.exe\n").unwrap();

        let err = apply_at(&path, true, &reviewed.fingerprint).expect_err("must refuse");
        assert!(err.contains("changed since the preview"), "{err}");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "// somebody else's edit\n// montes-hook.exe\n"
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn an_older_plugin_reads_as_not_installed() {
        let path = scratch("stale");
        std::fs::write(&path, "// Montes, but from an older build\n// montes-hook.exe\n").unwrap();
        // It is ours, so it may be replaced or removed — but it is not what this
        // build ships, and claiming otherwise would make the status a guess.
        let status = status_at(&path, Path::new(HOOK));
        assert!(!status.installed);
        assert!(!status.foreign);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn removing_something_that_is_never_there_is_not_an_error() {
        let path = scratch("absent");
        let preview = preview_at(&path, false).unwrap();
        assert_eq!(preview.diff, "No change.");
        assert!(apply_at(&path, false, &preview.fingerprint).expect("nothing to do").is_empty());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

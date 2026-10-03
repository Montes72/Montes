// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// An extra agent wired to the same `montes-hook` relay. Each one owns a JSON
/// hook config of its own (`path`) and the events it should report; Montes writes
/// `montes-hook.exe --agent <name> <Event>` into it, with the same backup/diff
/// flow as the Claude Code hooks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    /// `^[a-z0-9-]{1,24}$`, never "claude" (that pill is taken).
    pub name: String,
    /// Full path to the tool's JSON hook config.
    pub path: String,
    /// Which HOOK_EVENTS to install for this agent.
    #[serde(default)]
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Which back end answers: "auto" (a key means Claude, no key means Ollama),
    /// or a name the user pinned. Anything unrecognised is treated as "auto",
    /// because refusing to chat over an unknown string would be worse.
    #[serde(default = "default_provider")]
    pub provider: String,
    /// Where Ollama listens. Normalised before every request, so "localhost:11434"
    /// without a scheme works.
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    /// Which installed model to use.
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
    /// Extra agents wired to the relay (see `Agent`). Empty for a fresh install.
    #[serde(default)]
    pub agents: Vec<Agent>,
    /// Which language the two windows and the tray menu speak. "en" or "ru";
    /// anything else is read as English rather than as a refusal to start.
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "en".to_string()
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

fn default_provider() -> String {
    "auto".to_string()
}

fn default_ollama_url() -> String {
    crate::ollama::DEFAULT_URL.to_string()
}

fn default_ollama_model() -> String {
    crate::ollama::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            provider: default_provider(),
            ollama_url: default_ollama_url(),
            ollama_model: default_ollama_model(),
            agents: Vec::new(),
            language: default_language(),
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(crate::platform::HOOK_EXE)
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    let path = settings_path();
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        // No file is the ordinary first run, not something to report.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Settings::default(),
        Err(err) => {
            crate::log::line(format!("settings unreadable at {}: {err}", path.display()));
            return Settings::default();
        }
    };
    match parse(&bytes) {
        Ok(settings) => settings,
        Err(err) => {
            // Falling back is right — the app still runs — but doing it quietly is
            // not: the user's settings are one edit away from being replaced by
            // defaults and nothing on screen says so. Say it where it can be found.
            crate::log::line(format!(
                "settings unreadable at {} ({err}); using defaults",
                path.display()
            ));
            Settings::default()
        }
    }
}

/// The settings as they are on disk, which is not quite the bytes `save` wrote.
///
/// Notepad on Windows — the obvious tool for "I want to change one of these" —
/// saves UTF-8 *with a byte-order mark*, and `serde_json` rejects one. Left
/// alone that is not a parse error the user ever sees: it is every preference
/// quietly back at its default, with nothing in the log and nothing on screen to
/// say why. Three invisible bytes, and the app looks like it forgot everything.
fn parse(bytes: &[u8]) -> Result<Settings, serde_json::Error> {
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    serde_json::from_slice(body)
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact bytes `save` would write, so a test never has to remember every
    /// field `Settings` grew.
    fn as_saved(s: &Settings) -> Vec<u8> {
        serde_json::to_vec_pretty(s).unwrap()
    }

    #[test]
    fn settings_saved_by_notepad_are_read_back() {
        // Notepad writes a BOM. Before this was handled that was not a warning,
        // it was a silent reset: unwrap_or_default() handed back a Settings with
        // every preference at its default and the app carried on as if the file
        // said what it said.
        let mut s = Settings::default();
        s.sound_volume = 0.42;
        s.model = "claude-opus-5".into();

        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice(&as_saved(&s));

        let got = parse(&with_bom).expect("a file Notepad wrote should still parse");
        assert_eq!(got.sound_volume, 0.42);
        assert_eq!(got.model, "claude-opus-5");

        // And the same file without one, which is what save() writes.
        assert_eq!(parse(&as_saved(&s)).unwrap().sound_volume, 0.42);
    }

    #[test]
    fn a_bom_only_starts_the_file_and_is_not_eaten_from_a_value() {
        // strip_prefix, not trim: exactly one is removed, and a second one is
        // left to be the parse error it is.
        let mut twice = vec![0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF];
        twice.extend_from_slice(&as_saved(&Settings::default()));
        assert!(parse(&twice).is_err());
    }

    #[test]
    fn a_settings_file_from_before_the_language_setting_still_loads() {
        // Every file written before Phase 10 has no `language` key at all. That is
        // a file the app has to keep reading, not a broken one.
        let mut obj: serde_json::Value =
            serde_json::from_slice(&as_saved(&Settings::default())).unwrap();
        obj.as_object_mut().unwrap().remove("language");
        let got = parse(&serde_json::to_vec(&obj).unwrap())
            .expect("an older settings file should still load");
        // Not the default of the field: nobody chose one, so it is what the app
        // said before the setting existed.
        assert_eq!(got.language, "en");
    }
}

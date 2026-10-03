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
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}

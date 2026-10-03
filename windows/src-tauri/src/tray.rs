// Notification-area icon: Open, Settings, Pause, Quit.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::i18n;
use crate::island::WINDOW_LABEL;

/// The language the current menu is written in. Tauri bakes menu text when the
/// item is created, so a language change means handing the icon a new menu; this
/// is what says whether that is needed.
static BUILT_WITH: Mutex<String> = Mutex::new(String::new());

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", i18n::t("Open Montes"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", i18n::t("Settings…"), true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", i18n::t("Pause"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", i18n::t("Quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &pause, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id("montes")
        .tooltip("Montes")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    *BUILT_WITH.lock().unwrap() = crate::settings::load().language;
    Ok(())
}

/// Gives the tray a menu in the new language.
///
/// A no-op unless the language actually changed, so an ordinary settings save —
/// moving the volume, adding an agent — leaves the menu alone. Menu items are
/// immutable in Tauri, hence a fresh menu rather than re-labelled ones: the
/// handler is on the icon, not on the items, so nothing has to be rewired.
pub fn relabel(app: &AppHandle) {
    let language = crate::settings::load().language;
    let built_with = BUILT_WITH.lock().unwrap().clone();
    if !i18n::changed(&built_with, &language) {
        return;
    }
    let open = match MenuItem::with_id(app, "open", i18n::t("Open Montes"), true, None::<&str>) {
        Ok(item) => item,
        Err(err) => {
            eprintln!("[montes] tray menu: {err}");
            return;
        }
    };
    let settings = match MenuItem::with_id(app, "settings", i18n::t("Settings…"), true, None::<&str>)
    {
        Ok(item) => item,
        Err(err) => {
            eprintln!("[montes] tray menu: {err}");
            return;
        }
    };
    let pause = match MenuItem::with_id(app, "pause", i18n::t("Pause"), true, None::<&str>) {
        Ok(item) => item,
        Err(err) => {
            eprintln!("[montes] tray menu: {err}");
            return;
        }
    };
    let quit = match MenuItem::with_id(app, "quit", i18n::t("Quit"), true, None::<&str>) {
        Ok(item) => item,
        Err(err) => {
            eprintln!("[montes] tray menu: {err}");
            return;
        }
    };
    let Ok(sep1) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(sep2) = PredefinedMenuItem::separator(app) else {
        return;
    };
    let Ok(menu) = Menu::with_items(app, &[&open, &sep1, &settings, &pause, &sep2, &quit]) else {
        return;
    };
    let Some(icon) = app.tray_by_id("montes") else {
        return;
    };
    // Best effort: a tray that could not be relabelled keeps the menu it had,
    // which is the old language — worse, but not broken.
    if let Err(err) = icon.set_menu(Some(menu)) {
        eprintln!("[montes] tray menu: {err}");
        return;
    }
    *BUILT_WITH.lock().unwrap() = language;
}

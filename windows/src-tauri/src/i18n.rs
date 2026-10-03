// The tray menu, in the user's language.
//
// English is the source language and the English string is the key, the same
// shape the front end uses (`core/i18n.ts`), so a sentence is written once and a
// language missing a line shows English rather than a key.
//
// Only what Rust draws goes here. Messages that arrive as an error from a file
// write, a model download or a network call stay in English on purpose: they
// quote paths, flags and ports, and half-translating a sentence that quotes a
// file path helps nobody.

/// `t` for a known language. Separate from `t` so the table can be tested
/// without reading the settings file of whatever machine runs the tests.
pub fn t_in(lang: &str, key: &str) -> String {
    let hit = if lang == "ru" { ru(key) } else { None };
    match hit {
        Some(text) => text.to_string(),
        // The fallback is the contract: an unknown language, or a sentence this
        // build never learned, is the English that is already in the code.
        None => key.to_string(),
    }
}

/// The same, with a value in the sentence — a URL, a path, a count.
///
/// A key that contains `{name}` is looked up with that name still in it, so the
/// table stays one line per sentence instead of one line per combination.
pub fn tf_in(lang: &str, key: &str, name: &str, value: &str) -> String {
    // The table is keyed by the key with the hole still in it: "{url}" is part of
    // the sentence's identity, so a table line survives the value changing.
    let hole = format!("{{{name}}}");
    match if lang == "ru" { ru(key) } else { None } {
        Some(text) => text.replace(&hole, value),
        None => key.replace(&hole, value),
    }
}



/// The tray's own strings, in the saved language.
pub fn t(key: &str) -> String {
    t_in(&crate::settings::load().language, key)
}

/// True when `now` is not the language `built_with` was built in, which is the
/// cue to hand the tray a fresh menu.
///
/// Both languages are passed in on purpose: comparing against the settings file
/// would make the answer depend on what the machine running the test happens to
/// have saved, and "does this menu need rebuilding" is a question about the two
/// languages, not about the disk.
pub fn changed(built_with: &str, now: &str) -> bool {
    t_in(built_with, "Quit") != t_in(now, "Quit")
}

fn ru(key: &str) -> Option<&'static str> {
    Some(match key {
        // The tray.
        "Open Montes" => "Открыть Montes",
        "Settings…" => "Настройки…",
        "Pause" => "Пауза",
        "Quit" => "Выход",

        // The sentence the Assistant card exists to show: who answers, and why.
        "No Anthropic API key. Save one in Settings, or let the assistant choose for you." =>
            "Нет ключа Anthropic API. Сохраните его в настройках или позвольте ассистенту выбрать самому.",
        "Claude, because you chose it." => "Claude, потому что вы выбрали его сами.",
        "Ollama at {url}, because you chose it." =>
            "Ollama на {url}, потому что вы выбрали её сами.",
        "Ollama is not answering at {url}." => "Ollama не отвечает на {url}.",
        "Claude — an Anthropic API key is saved." =>
            "Claude — ключ Anthropic API сохранён.",
        "Ollama at {url} — there is no Anthropic API key." =>
            "Ollama на {url} — ключа Anthropic API нет.",
        "Nothing can answer yet: there is no Anthropic API key, and Ollama did not answer at {url}. Start Ollama, or save a key here." =>
            "Пока отвечать некому: ключа Anthropic API нет, и Ollama не отвечает на {url}. Запустите Ollama или сохраните ключ здесь.",

        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_language_missing_a_line_falls_back_to_english() {
        assert_eq!(t_in("ru", "Quit"), "Выход");
        // A key this build never had is English, not an empty menu entry.
        assert_eq!(t_in("ru", "Bring up the island"), "Bring up the island");
        // So is a language nobody speaks.
        assert_eq!(t_in("fr", "Quit"), "Quit");
        assert_eq!(t_in("", "Quit"), "Quit");
    }

    #[test]
    fn the_tray_strings_are_all_in_russian() {
        // Every string tray.rs builds has a Russian line. Missing one would leave
        // a single English word in the menu — in the one place the user has no
        // language picker to fix it with.
        for key in ["Open Montes", "Settings…", "Pause", "Quit"] {
            assert!(ru(key).is_some(), "{key} has no Russian line");
        }
    }

    #[test]
    fn a_sentence_with_a_hole_keeps_the_value_it_was_given() {
        // The address is the user's, and it has to come out the other side
        // unchanged — a translated table that mangled the URL would be worse than
        // no translation at all.
        let out = tf_in("ru", "Ollama at {url}, because you chose it.", "url", "http://box:11434");
        assert_eq!(out, "Ollama на http://box:11434, потому что вы выбрали её сами.");

        // An unlearned sentence still gets its hole filled, in either language.
        for lang in ["en", "ru"] {
            let out = tf_in(lang, "Nothing at {url} yet.", "url", "http://box:11434");
            assert_eq!(out, "Nothing at http://box:11434 yet.");
        }
    }

    #[test]
    fn the_menu_is_only_rebuilt_when_the_language_really_changed() {
        // Rebuilding on every settings save would be wasteful and would flicker
        // the menu under the user's cursor while they move the volume slider.
        assert!(!changed("en", "en"));
        assert!(!changed("ru", "ru"));
        assert!(changed("en", "ru"));
        assert!(changed("ru", "en"));
        // An unknown language draws English, so switching to one is not a change
        // the menu can show.
        assert!(!changed("en", "klingon"));
        assert!(!changed("klingon", "en"));
    }
}
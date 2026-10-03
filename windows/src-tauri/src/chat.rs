// The conversation itself: which back end answers, and what a dropped file or a
// captured window turns into before any back end sees it.
//
// Both back ends render the same neutral `Attachment`, because Anthropic and
// Ollama spell a picture completely differently — one wants a `source` block with
// a `data:` prefix, the other wants a bare base64 string in a side array. Keeping
// that translation here means the two providers only ever deal with what is
// genuinely theirs, and the shared history lives in one place.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::claude;
use crate::i18n;
use crate::ollama;
use crate::secrets;
use crate::settings::Settings;

/// Text and code files are inlined; anything larger is skipped.
pub const MAX_INLINE_TEXT: u64 = 200_000;

/// Who is answering. `claude` is the API and `ollama` is a model running on the
/// user's own machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Ollama,
}

/// Who answers, and why — shown in the settings so the automatic rule is never a
/// black box.
///
/// A back end that cannot answer is an error rather than a `reachable: false`
/// here: there is nothing to fall back to, so the reason belongs in the message
/// the island shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProvider {
    pub provider: Provider,
    /// False when the user pinned a back end by hand, true when the automatic
    /// rule picked this one.
    pub automatic: bool,
    /// Why this one, in a sentence the settings can show as it is rather than
    /// reimplementing the rule.
    pub note: String,
}

/// Resolves the stored preference into a back end that can actually answer.
pub async fn resolve(settings: &Settings) -> Result<ResolvedProvider, String> {
    let url = ollama::normalise_url(&settings.ollama_url);
    let has_key = secrets::get("anthropic-api-key").is_some();

    // Only one of the two needs a network round trip: Claude is reachable as soon
    // as there is a key, and asking Ollama anyway would put a probe in front of
    // every single question.
    let local = match settings.provider.as_str() {
        "claude" => Ok(()),
        _ => ollama::probe(&url).await,
    };
    decide(&settings.provider, has_key, &url, local, &settings.language)
}

/// The rule itself, with everything it needs already in hand.
///
/// Split out from `resolve` so it can be tested without a credential manager or a
/// socket: "a key means Claude, no key means the local model" is the whole promise
/// of this feature, and it is worth a test that cannot be moved by a network.
///
/// The language comes in rather than being read from the settings file, so the
/// tests below can state the language they are about instead of depending on
/// whatever the machine running them has saved.
fn decide(
    preference: &str,
    has_key: bool,
    url: &str,
    local: Result<(), String>,
    lang: &str,
) -> Result<ResolvedProvider, String> {
    // These sentences are read on the Assistant card and in the island, so they are
    // translated like any other interface line. The `{url}` hole stays a hole so
    // the table has one line per sentence and the front end can show the address
    // the user typed, unchanged.
    match preference {
        "claude" => {
            if !has_key {
                return Err(i18n::t_in(
                    lang,
                    "No Anthropic API key. Save one in Settings, or let the assistant choose for you.",
                ));
            }
            Ok(ResolvedProvider {
                provider: Provider::Claude,
                automatic: false,
                note: i18n::t_in(lang, "Claude, because you chose it."),
            })
        }
        "ollama" => local
            .map(|()| ResolvedProvider {
                provider: Provider::Ollama,
                automatic: false,
                note: i18n::tf_in(
                    lang,
                    "Ollama at {url}, because you chose it.",
                    "url",
                    url,
                ),
            })
            .map_err(|e| {
                // The address is in the sentence and the failure reason quotes the
                // request verbatim, so only the frame around it is translated.
                format!(
                    "{} {}",
                    i18n::tf_in(lang, "Ollama is not answering at {url}.", "url", url),
                    e
                )
            }),
        // "auto", and anything a newer build wrote that this one has never heard of.
        _ if has_key => Ok(ResolvedProvider {
            provider: Provider::Claude,
            automatic: true,
            note: i18n::t_in(lang, "Claude — an Anthropic API key is saved."),
        }),
        _ => local
            .map(|()| ResolvedProvider {
                provider: Provider::Ollama,
                automatic: true,
                note: i18n::tf_in(
                    lang,
                    "Ollama at {url} — there is no Anthropic API key.",
                    "url",
                    url,
                ),
            })
            .map_err(|_| {
                i18n::tf_in(
                    lang,
                    "Nothing can answer yet: there is no Anthropic API key, and Ollama did not answer at {url}. Start Ollama, or save a key here.",
                    "url",
                    url,
                )
            }),
    }
}

// ── History ───────────────────────────────────────────────────────────────────

/// The multi-turn history, plus which back end wrote it.
///
/// A local model and the API keep history in genuinely different shapes — one
/// stores a text string and a side array of pictures, the other stores a list of
/// typed blocks and may carry tool calls across turns. Switching back ends
/// therefore ends the conversation rather than feeding one backend's syntax to
/// the other, which is the only behaviour that cannot produce nonsense.
#[derive(Default)]
pub struct Chat {
    messages: Mutex<Vec<Value>>,
    provider: Mutex<Option<Provider>>,
}

impl Chat {
    pub fn reset(&self) {
        let mut messages = self.messages.lock().unwrap();
        messages.clear();
        *self.provider.lock().unwrap() = None;
    }

    /// Locks in the back end for this conversation and reports whether this is
    /// the first turn of it. Switching back ends starts a new conversation: the
    /// two keep history in shapes the other cannot read.
    pub fn begin(&self, provider: Provider) -> bool {
        let mut messages = self.messages.lock().unwrap();
        let mut current = self.provider.lock().unwrap();
        if *current != Some(provider) {
            messages.clear();
            *current = Some(provider);
        }
        messages.is_empty()
    }

    /// Records the user's message and hands back the whole conversation, that
    /// message included, exactly as the request has to carry it.
    ///
    /// Committing and reading the history are one step on purpose: a provider
    /// that snapshots first and pushes afterwards sends the model the
    /// conversation *minus* the question, which it answers with complete
    /// confidence and total nonsense.
    pub fn turn(&self, user: Value) -> Vec<Value> {
        let mut messages = self.messages.lock().unwrap();
        messages.push(user);
        messages.clone()
    }

    /// Records the assistant's answer.
    pub fn commit(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    /// Undoes a turn the back end never answered, so the history stays exactly
    /// as long as what the model actually saw.
    pub fn rollback(&self) {
        self.messages.lock().unwrap().pop();
    }

    /// The conversation so far, for tests.
    #[cfg(test)]
    pub fn messages(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

// ── Attachments ───────────────────────────────────────────────────────────────

/// A piece of context, in the shape the user dropped it, before any back end has
/// opinions about it.
#[derive(Debug)]
pub enum Attachment {
    /// A picture, as base64 with no `data:` prefix.
    Image { media_type: String, data: String },
    /// Plain text, or a line of description the back end is to read as prose.
    Text { body: String },
    /// A format only Anthropic takes as a `document` block. Ollama gets the
    /// same bytes as text instead, which is lossy but honest.
    Document { media_type: String, data: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File {
        name: String,
        path: String,
    },
    Window {
        app_name: String,
        title: String,
        url: Option<String>,
        image: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}

/// Turns the dropped thing into attachments. Empty when there is no context, or
/// when the file turned out to be unreadable — neither is worth an error.
pub fn opening_turn(context: &ChatContext) -> Vec<Attachment> {
    let mut out = Vec::new();
    match context {
        ChatContext::File { name, path } => {
            if let Some(att) = read_file(path) {
                out.push(att);
            }
            out.push(Attachment::Text {
                body: format!("File: {name}"),
            });
        }
        ChatContext::Window {
            app_name,
            title,
            url,
            image,
        } => {
            // The screenshot first, then what it is: the model reads the picture
            // as part of the question rather than as a caption attached to
            // somebody else's words.
            if let Some(image) = image {
                out.push(Attachment::Image {
                    media_type: "image/png".to_string(),
                    data: image.clone(),
                });
            }
            let mut text = format!("Context — App: {app_name}, Window: {title}");
            if let Some(url) = url {
                text.push_str(&format!(", URL: {url}"));
            }
            out.push(Attachment::Text { body: text });
        }
    }
    out
}

/// PDF → document, image → image, text/code → inline text.
fn read_file(path: &str) -> Option<Attachment> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "pdf" => Some("application/pdf"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    };

    if let Some(media_type) = media_type {
        let bytes = std::fs::read(path).ok()?;
        return Some(match ext.as_str() {
            "pdf" => Attachment::Document {
                media_type: media_type.to_string(),
                data: crate::claude::base64_for(&bytes),
            },
            _ => Attachment::Image {
                media_type: media_type.to_string(),
                data: crate::claude::base64_for(&bytes),
            },
        });
    }

    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_INLINE_TEXT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(Attachment::Text {
        body: format!("File contents:\n{text}"),
    })
}

// ── One turn ──────────────────────────────────────────────────────────────────

/// One chat turn, on whichever back end the settings resolve to.
pub async fn send(
    chat: &Chat,
    settings: &Settings,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let resolved = resolve(settings).await?;

    // Context rides along with the first message only: on every later turn the
    // model already has it, and repeating it would crowd out the question.
    let opening = if chat.begin(resolved.provider) {
        context.as_ref().map(opening_turn).unwrap_or_default()
    } else {
        Vec::new()
    };

    match resolved.provider {
        Provider::Claude => claude::send(chat, opening, &settings.model, query).await,
        Provider::Ollama => {
            let url = ollama::normalise_url(&settings.ollama_url);
            ollama::send(chat, opening, &url, &settings.ollama_model, query).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const UP: Result<(), String> = Ok(());
    const DOWN: Result<(), String> = Err(String::new());

    fn ask(text: &str) -> Value {
        json!({ "role": "user", "content": text })
    }

    // ── Who answers ───────────────────────────────────────────────────────────
    //
    // English throughout: these are about which back end answers, and a test
    // that read the operator's own settings would fail on a Russian machine for
    // a reason that has nothing to do with the rule. The Russian wording has its
    // own test at the bottom.
    const EN: &str = "en";

    #[test]
    fn a_key_means_claude_and_no_key_means_the_machine() {
        // The whole feature in two lines. Anything cleverer here would surprise
        // somebody who removed a key on purpose to stop being billed.
        let with_key = decide("auto", true, "http://localhost:11434", DOWN, EN).unwrap();
        assert_eq!(with_key.provider, Provider::Claude);
        assert!(with_key.automatic);

        let without = decide("auto", false, "http://localhost:11434", UP, EN).unwrap();
        assert_eq!(without.provider, Provider::Ollama);
        assert!(without.automatic);
    }

    #[test]
    fn nothing_to_answer_with_is_said_in_one_sentence() {
        // The failure has to name both ways out, because both are one click away.
        let err = decide("auto", false, "http://localhost:11434", DOWN, EN).unwrap_err();
        assert!(err.contains("no Anthropic API key"), "{err}");
        assert!(err.contains("http://localhost:11434"), "{err}");
        assert!(err.contains("Start Ollama"), "{err}");
    }

    #[test]
    fn a_pinned_back_end_is_never_the_automatic_one() {
        let claude = decide("claude", true, "http://localhost:11434", DOWN, EN).unwrap();
        assert_eq!(claude.provider, Provider::Claude);
        assert!(!claude.automatic, "the user chose it, so it is not automatic");

        let ollama = decide("ollama", true, "http://localhost:11434", UP, EN).unwrap();
        assert_eq!(ollama.provider, Provider::Ollama, "a key does not overrule a pin");
        assert!(!ollama.automatic);
    }

    #[test]
    fn pinning_something_that_cannot_answer_says_which_one() {
        let no_key = decide("claude", false, "http://localhost:11434", UP, EN).unwrap_err();
        assert!(no_key.contains("No Anthropic API key"), "{no_key}");

        // Ollama's own words about why, kept in the sentence rather than dropped.
        let refused =
            decide("ollama", true, "http://localhost:11434", Err("connection refused".into()), EN)
                .unwrap_err();
        assert!(refused.contains("http://localhost:11434"), "{refused}");
        assert!(refused.contains("connection refused"), "{refused}");
    }

    #[test]
    fn a_preference_from_a_newer_build_falls_back_to_the_rule() {
        // Refusing to chat over an unrecognised string would be worse than
        // ignoring it.
        let resolved = decide("gemini", true, "http://localhost:11434", DOWN, EN).unwrap();
        assert_eq!(resolved.provider, Provider::Claude);
        assert!(resolved.automatic);
    }

    #[test]
    fn russian_says_the_same_thing_about_the_same_state() {
        // The rule must not change with the language: what answers, and why, is
        // the same answer in Russian. Only the words move.
        let en = decide("auto", true, "http://box:11434", DOWN, "en").unwrap();
        let ru = decide("auto", true, "http://box:11434", DOWN, "ru").unwrap();
        assert_eq!(en.provider, ru.provider);
        assert_eq!(en.automatic, ru.automatic);
        assert_ne!(en.note, ru.note, "a language that changed nothing is not a translation");

        // The sentence that has an address in it keeps the address it was given.
        let en = decide("ollama", true, "http://box:11434", UP, "en").unwrap();
        let ru = decide("ollama", true, "http://box:11434", UP, "ru").unwrap();
        assert!(ru.note.contains("http://box:11434"), "{ru:?}");
        assert_eq!(en.provider, ru.provider);
        assert!(!ru.automatic, "the pin survives the translation");

        // And the failure that names both ways out still names both of them.
        let err = decide("auto", false, "http://box:11434", DOWN, "ru").unwrap_err();
        assert!(err.contains("http://box:11434"), "{err}");
        assert!(!err.contains("{url}"), "a hole reached the screen: {err}");

        // A language nobody speaks is English, never a blank note.
        let unknown = decide("auto", true, "http://box:11434", DOWN, "klingon").unwrap();
        assert_eq!(unknown.note, decide("auto", true, "http://box:11434", DOWN, "en").unwrap().note);
    }

    // ── History ───────────────────────────────────────────────────────────────

    #[test]
    fn the_question_is_part_of_the_history_the_request_carries() {
        // The bug this guards: snapshotting the history and pushing the question
        // afterwards sends the model everything except what was just asked.
        let chat = Chat::default();
        assert!(chat.begin(Provider::Claude));

        let carried = chat.turn(ask("what is in this picture?"));
        assert_eq!(carried.len(), 1);
        assert_eq!(carried[0]["content"], "what is in this picture?");
        assert_eq!(chat.messages().len(), 1);

        chat.commit(json!({ "role": "assistant", "content": "a screenshot" }));
        let carried = chat.turn(ask("and the title bar?"));
        assert_eq!(carried.len(), 3);
        assert_eq!(carried[2]["content"], "and the title bar?");
    }

    #[test]
    fn only_the_first_turn_is_an_opening_one() {
        let chat = Chat::default();
        assert!(chat.begin(Provider::Claude), "the first turn opens");
        chat.turn(ask("one"));
        assert!(!chat.begin(Provider::Claude), "the second does not");
    }

    #[test]
    fn switching_back_ends_starts_a_new_conversation() {
        // The two keep history in shapes the other cannot read, so handing one
        // back end's messages to the other is the one thing that cannot work.
        let chat = Chat::default();
        chat.begin(Provider::Claude);
        chat.turn(ask("one"));
        chat.commit(json!({ "role": "assistant", "content": [{ "type": "text", "text": "two" }] }));

        assert!(chat.begin(Provider::Ollama), "a new back end gets a clean start");
        assert!(chat.messages().is_empty());

        // A turn in Ollama's own shape, which the API client could not have read.
        chat.turn(json!({ "role": "user", "content": "three" }));
        chat.commit(json!({ "role": "assistant", "content": "four" }));

        assert!(chat.begin(Provider::Claude), "and back again");
        assert!(chat.messages().is_empty(), "nothing crosses between the two");
    }

    #[test]
    fn a_turn_the_back_end_never_answered_leaves_no_trace() {
        let chat = Chat::default();
        chat.begin(Provider::Ollama);
        chat.turn(ask("one"));
        chat.rollback();
        assert!(chat.messages().is_empty());
        assert!(chat.begin(Provider::Ollama), "still the opening turn");
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    #[test]
    fn a_text_file_becomes_an_attachment_naming_the_file() {
        let path = std::env::temp_dir().join("montes-chat-test.rs");
        std::fs::write(&path, "fn main() {}").unwrap();

        let attachments = opening_turn(&ChatContext::File {
            name: "montes-chat-test.rs".to_string(),
            path: path.to_string_lossy().to_string(),
        });
        let _ = std::fs::remove_file(&path);

        assert_eq!(attachments.len(), 2);
        match &attachments[0] {
            Attachment::Text { body } => assert!(body.contains("fn main() {}"), "{body}"),
            other => panic!("expected the file's text, got {other:?}"),
        }
        match &attachments[1] {
            Attachment::Text { body } => assert_eq!(body, "File: montes-chat-test.rs"),
            other => panic!("expected the file name, got {other:?}"),
        }
    }

    #[test]
    fn a_pdf_is_a_document_and_not_a_picture() {
        // Only Anthropic has a document block. Reading the extension wrong here
        // would hand a PDF to an image-capable model as a broken picture.
        let path = std::env::temp_dir().join("montes-chat-test.pdf");
        std::fs::write(&path, b"%PDF-1.7\n").unwrap();

        let attachments = opening_turn(&ChatContext::File {
            name: "montes-chat-test.pdf".to_string(),
            path: path.to_string_lossy().to_string(),
        });
        let _ = std::fs::remove_file(&path);

        assert_eq!(attachments.len(), 2);
        match &attachments[0] {
            Attachment::Document { media_type, data } => {
                assert_eq!(media_type, "application/pdf");
                assert!(!data.starts_with("data:"), "no data: prefix — providers add it");
            }
            other => panic!("expected a document, got {other:?}"),
        }
    }

    #[test]
    fn a_dropped_window_brings_its_picture_and_its_name() {
        let attachments = opening_turn(&ChatContext::Window {
            app_name: "chrome".to_string(),
            title: "Rust docs - Result".to_string(),
            url: Some("https://doc.rust-lang.org".to_string()),
            image: Some("iVBORw0KGgo=".to_string()),
        });

        assert_eq!(attachments.len(), 2);
        match &attachments[0] {
            Attachment::Image { media_type, data } => {
                assert_eq!(media_type, "image/png");
                assert_eq!(data, "iVBORw0KGgo=");
            }
            other => panic!("expected the picture first, got {other:?}"),
        }
        match &attachments[1] {
            Attachment::Text { body } => {
                assert!(body.contains("chrome"), "{body}");
                assert!(body.contains("Rust docs - Result"), "{body}");
                assert!(body.contains("https://doc.rust-lang.org"), "{body}");
            }
            other => panic!("expected the window's name, got {other:?}"),
        }
    }

    #[test]
    fn an_unreadable_file_is_skipped_rather_than_failing_the_turn() {
        // A dropped file can be deleted, moved or locked between the drop and the
        // question. That is worth the name alone, not an error.
        let attachments = opening_turn(&ChatContext::File {
            name: "gone.txt".to_string(),
            path: "C:\\nowhere\\gone.txt".to_string(),
        });

        assert_eq!(attachments.len(), 1);
        match &attachments[0] {
            Attachment::Text { body } => assert_eq!(body, "File: gone.txt"),
            other => panic!("expected only the name, got {other:?}"),
        }
    }
}

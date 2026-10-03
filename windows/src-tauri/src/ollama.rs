// Ollama — a model running on the user's own machine, reached over plain HTTP on
// the loopback interface. Nothing here ever leaves the machine unless the user
// has deliberately pointed the endpoint somewhere else.
//
// Montes treats it as the automatic answer when there is no Anthropic key to pay
// with, which makes it the difference between "the assistant works" and "the
// assistant asks me for money" on a fresh install.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::chat::{Attachment, Chat, ChatReply};

/// Loopback is the only default worth having: Ollama refuses to serve off its
/// own machine unless asked, and anybody who has moved it can say where.
pub const DEFAULT_URL: &str = "http://localhost:11434";
/// The smallest model that is worth chatting with. Overwritten by the settings
/// with whatever is actually installed.
pub const DEFAULT_MODEL: &str = "qwen3:14b";

/// A local model thinks in seconds, not in request round-trips: 30B parameters on
/// a laptop CPU need minutes, where the API answers inside the same 90 s. Reusing
/// Anthropic's budget here would cut off every long answer.
const CHAT_TIMEOUT_SECS: u64 = 600;

/// A reachability probe, not a chat. Two seconds is generous on loopback and
/// short enough that an island with no API key never feels hung.
const PROBE_TIMEOUT_SECS: u64 = 2;

/// Matches the API's own cap, so switching between back ends does not silently
/// halve how much the assistant is allowed to say. On a thinking model the
/// budget is shared with the thinking, which is what the empty-answer case in
/// `send` is about.
const MAX_PREDICT: u32 = 4096;

/// Ollama unloads a model after five idle minutes by default. For a 17 GB model
/// that is not a cache being trimmed, it is minutes of reloading before the next
/// question — and a chat session is exactly the opposite of idle.
const KEEP_ALIVE: &str = "10m";

/// Turns whatever the user typed into something a request can be built on: a
/// scheme, no trailing slash, no accidental whitespace.
pub fn normalise_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_URL.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    format!("http://{trimmed}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size_bytes: u64,
    /// False for a text-only model, which is the common case on a normal machine
    /// and the reason the dropped-window feature cannot work with a local model.
    pub vision: bool,
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

/// Is there anything to talk to at this endpoint? Nothing more — a chat would
/// load the model and take minutes to answer a yes/no question.
pub async fn probe(url: &str) -> Result<(), String> {
    let response = client(Duration::from_secs(PROBE_TIMEOUT_SECS))?
        .get(format!("{url}/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", response.status()))
    }
}

/// Everything installed, with what each model can actually do.
///
/// A recent server says what each model can do in the listing itself; an older one
/// does not, and only then is it worth asking again per model. Knowing a model
/// cannot look at a picture is the whole reason this list exists — guessing would
/// mean sending a screenshot into a model that silently drops it.
pub async fn models(url: &str) -> Result<Vec<OllamaModel>, String> {
    let http = client(Duration::from_secs(PROBE_TIMEOUT_SECS * 3))?;
    let text = http
        .get(format!("{url}/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let listed = parse_listing(&text, url)?;
    let mut out = Vec::with_capacity(listed.len());
    for (name, size_bytes, listed) in listed {
        let vision = match listed {
            Some(known) => known,
            // A model that will not answer this question is treated as text-only,
            // which is the safe direction: we would rather refuse a picture than
            // pretend a model looked at one.
            None => has_vision(&http, url, &name).await.unwrap_or(false),
        };
        out.push(OllamaModel {
            name,
            size_bytes,
            vision,
        });
    }
    Ok(out)
}

/// The installed models out of an `/api/tags` answer: name, size, and what the
/// listing itself claimed about pictures — `None` where it claimed nothing.
///
/// Split out from `models` so both shapes of answer can be tested against real
/// ones: a server that reports capabilities, and an older one that does not.
fn parse_listing(text: &str, url: &str) -> Result<Vec<(String, u64, Option<bool>)>, String> {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| v.get("models").and_then(Value::as_array).cloned())
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    let name = m.get("name")?.as_str()?.to_string();
                    let size = m.get("size").and_then(Value::as_u64).unwrap_or(0);
                    let vision = m
                        .get("capabilities")
                        .and_then(Value::as_array)
                        .map(|caps| caps.iter().any(|c| c.as_str() == Some("vision")));
                    Some((name, size, vision))
                })
                .collect()
        })
        .ok_or_else(|| format!("No models listed at {url}."))
}

/// What a single model can do.
///
/// A model that will not answer this request is reported as text-only, which is
/// the safe direction to be wrong in: we would rather refuse a picture than
/// pretend a model looked at one.
async fn has_vision(http: &reqwest::Client, url: &str, model: &str) -> Result<bool, String> {
    let value = http
        .post(format!("{url}/api/show"))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(value
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|caps| caps.iter().any(|c| c.as_str() == Some("vision"))))
}

/// The same question asked once, on the way to a chat, so a screenshot is never
/// handed to a model that would drop it.
async fn supports_vision(url: &str, model: &str) -> Result<bool, String> {
    let http = client(Duration::from_secs(PROBE_TIMEOUT_SECS * 3))?;
    has_vision(&http, url, model).await
}

/// One chat turn on the local model.
///
/// Ollama's history is a list of `{role, content}` with pictures in a side
/// `images` array, which is why this cannot share a representation with the API
/// client — `Chat::turn` returns the conversation in exactly that shape, and
/// `chat` keeps the two apart for exactly this reason.
pub async fn send(
    chat: &Chat,
    opening: Vec<Attachment>,
    url: &str,
    model: &str,
    query: String,
) -> Result<ChatReply, String> {
    if model.trim().is_empty() {
        return Err("No Ollama model chosen. Open settings.".to_string());
    }

    let mut images: Vec<String> = Vec::new();
    let mut prose = String::new();
    for att in opening {
        match att {
            Attachment::Image { data, .. } => images.push(data),
            Attachment::Text { body } => {
                if !prose.is_empty() {
                    prose.push('\n');
                }
                prose.push_str(&body);
            }
            // A local model has no document block to put a PDF in, and sending
            // the bytes as text would produce a confident answer to a question
            // about a page nobody ever read. Say so instead.
            Attachment::Document { media_type, .. } => {
                return Err(format!(
                    "{model} cannot read {media_type} files. Open the file and paste \
                     the part you want to talk about."
                ))
            }
        }
    }
    if !prose.is_empty() {
        prose.push_str("\n\n");
    }
    prose.push_str(&query);

    if !images.is_empty() && !supports_vision(url, model).await? {
        return Err(format!(
            "{model} is a text-only model, so it cannot look at the window you dropped. \
             Install a vision model, or ask about it in words."
        ));
    }

    let mut user = json!({ "role": "user", "content": prose });
    if !images.is_empty() {
        user["images"] = Value::from(images);
    }
    let messages = chat.turn(user);

    let body = json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "keep_alive": KEEP_ALIVE,
        "options": { "num_predict": MAX_PREDICT },
        "system": system_prompt(),
    });

    let response = match call(url, &body).await {
        Ok(v) => v,
        Err(err) => {
            chat.rollback();
            return Err(err);
        }
    };

    let message = response.get("message");
    let text = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();

    if text.is_empty() {
        chat.rollback();
        // qwen3 and its relatives think before they answer, and that thinking
        // counts against the same budget as the answer. A model that spent all
        // of it thinking has genuinely said nothing, and "no response text" would
        // hide why — so say why, and say what to do about it.
        let thought = message
            .and_then(|m| m.get("thinking"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        return Err(if thought.is_empty() {
            "No response text.".to_string()
        } else {
            format!(
                "{model} thought for the whole answer and never got to a reply. \
                 Ask again, or pick a model that does not think first."
            )
        });
    }

    let text = text.to_string();
    chat.commit(json!({ "role": "assistant", "content": text }));
    Ok(ChatReply { text })
}

/// Same reason as the API client: who Montes is, with nothing claimed that this
/// back end cannot do. A local model has no web search, and saying so up front
/// stops it inventing searches it never ran.
fn system_prompt() -> String {
    format!(
        "{} You are running on the user's own computer through Ollama, and you have no \
         web search and no internet access. If a question needs something you cannot \
         look up, say that plainly instead of guessing.",
        super::claude::PERSONA
    )
}

async fn call(url: &str, body: &Value) -> Result<Value, String> {
    let response = client(Duration::from_secs(CHAT_TIMEOUT_SECS))?
        .post(format!("{url}/api/chat"))
        .header("content-type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() || e.is_connect() {
                format!("No answer from Ollama at {url}. It may still be loading the model.")
            } else {
                format!("Ollama: {e}")
            }
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Ollama puts the reason in a plain `error` field — a model that does not
        // fit in memory, most usefully.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("Ollama {status}: {detail}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Bad response from Ollama: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{normalise_url, parse_listing};

    #[test]
    fn a_url_is_made_request_shaped() {
        assert_eq!(normalise_url("http://localhost:11434"), "http://localhost:11434");
        assert_eq!(normalise_url("http://localhost:11434/"), "http://localhost:11434");
        assert_eq!(normalise_url("  localhost:11434  "), "http://localhost:11434");
        assert_eq!(normalise_url(""), "http://localhost:11434");
        assert_eq!(normalise_url("192.168.1.5:11434"), "http://192.168.1.5:11434");
        assert_eq!(normalise_url("https://ollama.example"), "https://ollama.example");
    }

    /// Ollama 0.35's own answer for a machine with two text models on it.
    const REAL_LISTING: &str = r#"{
      "models": [
        { "name": "qwen3-coder:30b", "size": 18556700761,
          "capabilities": ["completion", "tools"] },
        { "name": "qwen3:14b", "size": 9276198565,
          "capabilities": ["completion", "tools", "thinking"] }
      ]
    }"#;

    #[test]
    fn a_listing_that_says_what_each_model_can_do_is_taken_at_its_word() {
        let listed = parse_listing(REAL_LISTING, "http://localhost:11434").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].0, "qwen3-coder:30b");
        assert_eq!(listed[0].1, 18556700761);
        // Neither of these can look at a picture, and saying so is the whole
        // reason this list is fetched.
        assert_eq!(listed[0].2, Some(false));
        assert_eq!(listed[1].2, Some(false));
    }

    #[test]
    fn an_older_listing_claims_nothing_and_is_asked_about_instead() {
        let old = r#"{ "models": [ { "name": "llama3.2:3b", "size": 2019393189 } ] }"#;
        let listed = parse_listing(old, "http://localhost:11434").unwrap();
        assert_eq!(listed[0].0, "llama3.2:3b");
        assert_eq!(listed[0].2, None, "no claim means a question, not a guess");
    }

    #[test]
    fn a_vision_model_is_recognised_rather_than_guessed_at() {
        let with_vision = r#"{ "models": [
            { "name": "llava:7b", "size": 4733363377, "capabilities": ["completion", "vision"] }
        ] }"#;
        let listed = parse_listing(with_vision, "http://localhost:11434").unwrap();
        assert_eq!(listed[0].2, Some(true));
    }

    #[test]
    fn an_answer_that_is_not_a_model_list_says_where_it_was_looking() {
        // An empty list is a real answer — nothing is installed — but a page of
        // HTML from something that is not Ollama is not, and it has to be
        // reported rather than shown as "you have no models".
        assert!(parse_listing(r#"{"models":[]}"#, "http://localhost:11434").unwrap().is_empty());
        let err = parse_listing("<html>proxy error</html>", "http://localhost:11434").unwrap_err();
        assert!(err.contains("http://localhost:11434"), "{err}");
    }
}

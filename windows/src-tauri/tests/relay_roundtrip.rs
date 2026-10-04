//! The decision round trip, end to end, with the real relay binary.
//!
//! Everything else about approving a permission is covered by unit tests on both
//! sides of the pipe, and the shapes on stdout are covered in the hook's own
//! tests. What none of them can cover is the thing they all assume: that a human
//! clicking Allow on the island actually reaches an agent waiting on the other
//! end of a named pipe. That link is a process boundary, a blocking read and a
//! hand-written line of text, and until someone watches it happen end to end,
//! "you can approve from the island" is a claim the suite is taking on trust.
//!
//! So this test spawns the real `montes-hook.exe`, serves the pipe the way
//! `docs/AGENTS.md` says an agent's host must, writes the decision an island
//! would write, and asserts on the bytes the agent would then read.
//!
//! The server side here is deliberately *not* the app's own `pipe::handle`. A
//! shared implementation would only prove the two halves agree with themselves;
//! this one follows the documented protocol instead, so a change to either side
//! that breaks the contract between them fails the test.
//!
//! Two things it cannot cover, stated plainly rather than left for a reader to
//! find out later: it never calls `pipe::handle` (that needs a live Tauri app, and
//! the decisions it waits for are unit-tested in `pipe.rs`), and it needs the pipe
//! name Montes serves, so it cannot run while the app is open.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::ServerOptions;

/// Only one server may own the relay pipe, and cargo runs tests in parallel, so
/// every round trip here takes this first. Skipped when the pipe is already taken
/// — by a sibling test, or by a running Montes.
fn the_pipe() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let lock = LOCK.get_or_init(|| Mutex::new(()));
    // A test that failed mid-way poisons the lock, and the next one still deserves
    // its turn: the failure is already recorded, and this is not a state machine.
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Where the relay binary is, given a test binary living in `target/…/deps`.
fn hook_exe() -> Option<PathBuf> {
    if let Ok(from_env) = std::env::var("MONTES_HOOK") {
        let path = PathBuf::from(from_env);
        return path.exists().then_some(path);
    }
    let mut dir = std::env::current_exe().ok()?;
    dir.pop(); // out of deps/
    if dir.ends_with("deps") {
        dir.pop();
    }
    let path = dir.join("montes-hook.exe");
    path.exists().then_some(path)
}

/// Serves exactly one connection: read the agent's line, answer, hang up.
///
/// `decision` is the word the island would have written when a human clicked, and
/// it is the one thing that varies between cases. Hard-coding it here would have
/// left every case asserting the same thing — and, being one word in one place,
/// nothing would have said so.
///
/// Returns what the agent actually sent, so a caller cannot mistake "the answer
/// looked right" for "an agent ever asked" — an empty read must fail the test,
/// not quietly pass it.
///
/// The wire format is a bare word and a newline — see pipe.rs. No JSON and no
/// envelope: turning the decision into whatever the agent understands is the
/// relay's job, which is the whole reason it lives in a separate binary.
fn serve_one(name: String, decision: &'static str) -> Result<String, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("runtime: {e}"))?
        .block_on(async move {
            // first_pipe_instance is what turns "somebody already owns this name"
            // into a clear failure instead of two servers quietly sharing a pipe.
            let mut server = ServerOptions::new()
                .first_pipe_instance(true)
                .create(&name)
                .map_err(|e| format!("pipe {name} is not available: {e}"))?;

            // Generous, because the relay is in the middle of starting a process.
            // The point of the test is that the agent waits for us, not that it is
            // quick about it.
            server.connect().await.map_err(|e| format!("connect: {e}"))?;

            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match server.read(&mut chunk).await {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.contains(&b'\n') || buf.len() > 1 << 20 {
                            break;
                        }
                    }
                    Err(e) => return Err(format!("read: {e}")),
                }
            }

            server
                .write_all(format!("{decision}\n").as_bytes())
                .await
                .map_err(|e| format!("write: {e}"))?;
            server.flush().await.map_err(|e| format!("flush: {e}"))?;
            let _ = server.disconnect();
            Ok(String::from_utf8_lossy(&buf).into_owned())
        })
}

/// Asks for permission as a real agent would, and returns what the agent would
/// then read on stdout, plus what it sent us. `None` means the round trip could
/// not be run here.
fn ask(hook: &Path, args: &[&str], decision: &'static str) -> Option<(String, String)> {
    let name = montes_lib::relay_pipe_name();
    let server = std::thread::spawn(move || serve_one(name, decision));

    // Only the decision differs between cases, and it is in both the id — so each
    // request is traceable in a log — and the answer the agent gets back.
    let payload = format!(
        r#"{{"hook_event_name":"PermissionRequest","request_id":"roundtrip-{decision}","session_id":"roundtrip","tool_name":"Bash","tool_input":{{"command":"echo round trip"}},"cwd":"C:\\"}}"#
    );

    let mut child = match Command::new(hook)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            cannot_run(&format!("cannot run {}: {e}", hook.display()));
            return None;
        }
    };

    // An agent hands its payload over and closes stdin; that is how a shell
    // invocation behaves, and the relay reads to the newline.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(payload.as_bytes());
        drop(stdin);
    }

    let out = match child.wait_with_output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_owned(),
        Err(e) => {
            cannot_run(&format!("waiting for the relay failed: {e}"));
            return None;
        }
    };

    // Both sides have to have worked, and saying so separately is the difference
    // between a useful failure and a mysterious empty string.
    match server.join() {
        Ok(Ok(asked)) => Some((out, asked)),
        Ok(Err(e)) => {
            cannot_run(&e);
            None
        }
        Err(_) => {
            cannot_run("the pipe server thread panicked");
            None
        }
    }
}

/// What the agent sent us has to be its own request, not an empty read.
///
/// Without this, a relay that connected and said nothing would still produce an
/// empty stdout — the same bytes as a silent timeout — and the round trip would
/// look like it passed while nothing had crossed the pipe.
fn assert_it_really_asked(asked: &str) {
    assert!(
        asked.contains(r#""hook_event_name":"PermissionRequest""#),
        "the relay connected but sent no permission request: {asked:?}"
    );
}

/// Reports why a round trip cannot run here, loudly.
///
/// A test that quietly passes without having run is worse than no test at all:
/// it reports the property as proven while proving nothing. So every skip names
/// what is missing and what would produce it.
fn cannot_run(reason: &str) {
    eprintln!(
        "\n  SKIPPED: {reason}\n\
         \n  These are the only tests that prove a decision reaches an agent.\n\
         To run them:\n\
         \x20   cargo test -p montes -p montes-hook --release\n\
         \x20 with Montes closed — it already owns the relay pipe.\n"
    );
}

#[test]
fn allow_reaches_a_third_party_agent_in_its_own_envelope() {
    let _pipe = the_pipe();
    let Some(hook) = hook_exe() else {
        return cannot_run("montes-hook.exe was not built alongside this test");
    };

    let Some((out, asked)) = ask(&hook, &["--agent", "gemini", "PermissionRequest"], "allow") else {
        return;
    };
    assert_it_really_asked(&asked);

    assert_eq!(
        out,
        r#"{"behavior":"allow"}"#,
        "an agent outside Claude Code has never heard of hookSpecificOutput, and \
         waiting out its own timeout on an envelope it cannot read helps nobody"
    );
}

#[test]
fn allow_reaches_claude_code_in_the_envelope_it_expects() {
    let _pipe = the_pipe();
    let Some(hook) = hook_exe() else {
        return cannot_run("montes-hook.exe was not built alongside this test");
    };

    let Some((out, asked)) = ask(&hook, &["PermissionRequest"], "allow") else {
        return;
    };
    assert_it_really_asked(&asked);

    assert_eq!(
        out,
        r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#,
        "Claude Code reads hookSpecificOutput and nothing else"
    );
}

/// The half of the promise that matters most when the answer is no: the reason has
/// to arrive. A bare `deny` with no explanation gives the human nothing to learn
/// from and the agent nothing to print.
#[test]
fn deny_carries_its_message_to_the_agent() {
    let _pipe = the_pipe();
    let Some(hook) = hook_exe() else {
        return cannot_run("montes-hook.exe was not built alongside this test");
    };

    let Some((out, asked)) = ask(&hook, &["--agent", "gemini", "PermissionRequest"], "deny") else {
        return;
    };
    assert_it_really_asked(&asked);

    assert_eq!(
        out,
        r#"{"behavior":"deny","message":"Denied from Montes"}"#,
        "a denial without a reason is a dead end for both the human and the agent"
    );
}

/// If the relay is asked and nobody answers, it must let go. This is the state
/// Montes is closed in, and it is the promise the hook's own header makes: a
/// missing Montes is not an error, and silence is what the agent reads.
#[test]
fn a_closed_montes_leaves_the_agent_free_to_continue() {
    // The lock is what makes "nobody is listening" true. Without it this test
    // spawns a second relay while a sibling owns the pipe, that sibling's server
    // answers whichever connection arrives first, and the two tests fail in a way
    // that looks like a relay bug rather than a race.
    let _pipe = the_pipe();
    let Some(hook) = hook_exe() else {
        return cannot_run("montes-hook.exe was not built alongside this test");
    };

    // Deliberately no server: nobody is going to answer this one.
    let started = Instant::now();
    let mut child = Command::new(&hook)
        .args(["--agent", "gemini", "PermissionRequest"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn montes-hook");
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(
            br#"{"hook_event_name":"PermissionRequest","request_id":"x","session_id":"s"}"#,
        );
        drop(stdin);
    }
    let out = child.wait_with_output().expect("wait for montes-hook");
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(10),
        "took {elapsed:?} to notice that nobody was listening"
    );
    assert!(out.status.success(), "a missing Montes is not an error");
    assert!(
        out.stdout.is_empty(),
        "silence is what an agent reads when nobody answered — it then asks in its own terminal"
    );
}
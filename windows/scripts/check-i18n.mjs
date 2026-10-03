// Checks the translation table against the code that has to read it.
//
// The rule the app is built on is "the English string is the key", which means
// the dictionary and the source drift apart the moment a sentence is reworded.
// Nothing at build time notices: `t("Settings…")` on a missing key is not an
// error, it is English — the fallback is the whole design — so the sentence
// silently loses its translation and the app looks broken in one language and
// fine in the other.
//
// Two questions, both cheap and both worth asking on every commit:
//
//   1. Does every key still exist in the source? A key nothing else mentions is
//      a translation of a sentence the app no longer says.
//   2. Is every sentence that reaches the screen in the table? The list is
//      deliberately approximate — it reads the source rather than the built app,
//      so it catches ids, class names and CSS values too — which is why the
//      noise it prints at the end is listed rather than treated as failures.
//
// Run: node scripts/check-i18n.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const DICT = join(SRC, "core", "i18n.ts");

/** Every .ts file in src, because a sentence can be said anywhere. */
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".ts")) files.push(path);
  }
})(SRC);

const read = (path) => readFileSync(path, "utf8");

// ── The table ────────────────────────────────────────────────────────────────
const table = read(DICT);
const body = table.slice(table.indexOf("const RU"), table.indexOf("let current"));

// An unquoted key is any identifier, including the accented ones the tool labels
// use — "Exécute:" is a key, not a syntax error.
const KEY = /^\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$À-ɏ]*)):\s*"/gm;
const keys = [];
for (const m of body.matchAll(KEY)) {
  keys.push((m[1] ?? m[2]).replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
}

// The dictionary is not "the source" for this check: a key nothing else
// mentions would still be found in i18n.ts, and the bug this exists to catch
// would hide there forever.
const elsewhere = files
  .filter((path) => path !== DICT)
  .map(read)
  .join("\n");

let stale = 0;
let drifted = 0;

/** The dashes and dots a hand-edited file silently turns into each other. */
const CONFUSABLES = /[—–…]/g;

/**
 * The same sentence with each dash allowed to be any other dash, so a match that
 * is *not* the key is a sentence that was reworded by hand and left its
 * translation behind.
 *
 * Only worth doing for keys that contain one: "Ask" is a substring of half the
 * interface, and matching that loosely says nothing at all.
 */const loosened = (key) =>
  new RegExp(
    key
      .split(CONFUSABLES)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[—–….\\-]"),
    "g",
  );

for (const key of keys) {
  if (!elsewhere.includes(key)) {
    console.log(`  stale     ${JSON.stringify(key)}`);
    console.log(`            nothing in src says this any more`);
    stale++;
    continue;
  }
  if (!CONFUSABLES.test(key)) continue;
  CONFUSABLES.lastIndex = 0;
  const wrong = [...elsewhere.matchAll(loosened(key))]
    .map((m) => m[0])
    .filter((hit) => hit !== key);
  if (wrong.length) {
    const shown = [...new Set(wrong)].map((w) => JSON.stringify(w)).join(", ");
    console.log(`  drifted   ${JSON.stringify(key)}  →  ${shown}`);
    console.log(`            the sentence in src changed shape; its translation did not`);
    drifted++;
  }
}

// ── What the screen actually receives ─────────────────────────────────────────
const shown = new Set();
const ATTR = /\b(?:text|title|placeholder|aria-label)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g;
const CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
// Choices live in plain arrays of strings — a provider, a credential label — so
// the check has to look at literals too, not only at h()'s named attributes.
const LITERAL =
  /"((?:[A-ZА-Я][^"\\]{3,}|(?:label|name):\s*"([^"\\]{3,})"))"/g;

for (const path of files) {
  if (path === DICT) continue;
  const code = read(path);
  for (const m of code.matchAll(ATTR)) {
    const s = (m[1] ?? m[2] ?? "").trim();
    if (s.length >= 2) shown.add(s.replace(/\\"/g, '"'));
  }
  for (const m of code.matchAll(CALL)) shown.add(m[1].replace(/\\"/g, '"'));
  for (const m of code.matchAll(LITERAL)) {
    const s = (m[1] ?? m[2] ?? "").trim();
    if (s.length >= 2) shown.add(s.replace(/\\"/g, '"'));
  }
}

// Not every quoted string is a sentence: brands, hook event names, credentials
// somebody pastes, font stacks. None of those are language.
const NOT_PROSE = new Set([
  "English",
  "Русский",
  "Montes",
  "Notch Buddy",
  "VS Code",
  "Stripe",
  "GitHub",
  "Vercel",
  "n8n",
  "Resend",
  "Notion",
  "Cal.com",
  "Segoe UI",
  "Segoe UI Variable Text",
  "Claude Opus 5",
  "Claude Sonnet 5",
  "Claude Haiku 4.5",
  "PermissionRequest",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "Session",
  "READY",
  "CANCELED",
]);

const isProse = (s) =>
  /[A-Za-z]{3}/.test(s) &&
  !/[А-Яа-яЁё]/.test(s) && // a value in the table, not a key
  !NOT_PROSE.has(s) &&
  !/^[a-z0-9.:/•←-]*$/i.test(s) &&
  !/…$/.test(s) &&
  !/[\\/]/.test(s); // a path, a placeholder to paste

const untranslated = [...shown].filter((s) => !keys.includes(s)).sort();
const prose = untranslated.filter(isProse);

// ── Sentences composed at runtime ─────────────────────────────────────────────
// The blind spot that lets a sentence through: a backtick string with a hole in
// it is already finished by the time `h()` sees it, so the lookup is a miss and
// the row shows in English with a path glued to it. The literal scan above cannot
// see these — it only reads quotes — which is why this is a separate pass rather
// than a wider regex.
//
// A hole on its own is not prose (`/sounds/${name}.wav`, a font stack, a log line),
// so this asks for a sentence shape first and a hole second.
const COMPOSED = /`([^`\n]*\$\{[^`\n]*)`/g;

/**
 * The words the template itself writes, with every `${…}` — and anything inside
 * one — taken out.
 *
 * This is the whole difference between a sentence and a join. `` `a${b}?` `` and
 * `` `${m.name}${t(" · text only")}` `` are the same shape to a regex, and only one
 * of them is an English sentence that will be read by a person.
 */
const literalParts = (s) => {
  const parts = [];
  let depth = 0;
  let mark = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "$" && s[i + 1] === "{") {
      parts.push(s.slice(mark, i));
      depth = 1;
      i++;
    } else if (depth > 0 && s[i] === "{") {
      depth++;
    } else if (depth > 0 && s[i] === "}") {
      if (--depth === 0) mark = i + 1;
    }
  }
  parts.push(s.slice(mark));
  return parts;
};

const isSentence = (s) => {
  const parts = literalParts(s);
  return parts.some(
    (part) =>
      /[A-Za-zА-Яа-яЁё]{2,}\s+[A-Za-zа-яё]/.test(part) && // two words, in a row
      !/^\s*\/|^\s*https?:|^#|rgb\(|hsla?\(/i.test(part) && // a URL, a route, a colour
      !/\.(?:wav|png|svg|woff2?|js|css|ts|rs|json)\b/i.test(part), // a filename
  ) || parts.some(
    // A lone capitalised word standing in front of a hole is a label — "Open
    // {name}", "Send {to}" — and it is a sentence the dictionary has to know
    // about just as much. Lower-case is how the joins read: a log line, a route,
    // an id.
    (part) => /^[A-Z][a-z]{2,}$/.test(part.trim()),
  );
};

const composed = [];
for (const path of files) {
  if (path === DICT) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, n) => {
      const text = line.trim();
      if (text.startsWith("//") || text.startsWith("*")) return;
      for (const m of text.matchAll(COMPOSED)) {
        const s = m[1].trim();
        if (!isSentence(s)) continue;
        // Already correct if it is a hole inside a t() call: the sentence was
        // wrapped, only the value is composed.
        if (/\bt\(\s*$/.test(text.slice(0, m.index))) continue;
        composed.push({ where: `${relative(root, path)}:${n + 1}`, s });
      }
    });
}

// ── Holes that were given the wrong name ──────────────────────────────────────
// `fill()` leaves a `{hole}` it was not handed on the screen, verbatim, in every
// language. Nothing catches it: the key is right, the sentence is right, the
// English rendering is right when the call site agrees with the table — and a
// mistyped name is a runtime value, so tsc has nothing to say about it.
const CALLED = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*\{([\s\S]{0,400}?)\}/g;
const HOLES = /\{(\w+)\}/g;

/**
 * The property names of an object-literal argument, or null if it is not a shape
 * this can read — a spread, a nested value, a computed key.
 *
 * Split on the commas that are at the top level rather than matching identifiers
 * with a regex: `{ max: MAX_ACTIVE }` has one name in it, not two, and a regex
 * cannot tell `MAX_ACTIVE` from `max` without the braces to anchor it.
 */
const names = (src) => {
  const parts = [];
  let depth = 0;
  let quote = "";
  let mark = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(src.slice(mark, i));
      mark = i + 1;
    }
  }
  parts.push(src.slice(mark));

  const out = new Set();
  for (const part of parts) {
    const named = part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (named) {
      out.add(named[1]);
      continue;
    }
    if (/^\s*[A-Za-z_$][\w$]*\s*$/.test(part)) {
      out.add(part.trim()); // the shorthand, `{ name }`
      continue;
    }
    if (part.trim()) return null; // something this cannot read
  }
  return out;
};

let mismatched = 0;
for (const path of files) {
  if (path === DICT) continue;
  const code = readFileSync(path, "utf8");
  // The whole file, not one line: a call written across four lines is still one
  // call, and reading it line by line turns every multi-line `t()` into a hole
  // error that is not there.
  for (const m of code.matchAll(CALLED)) {
    const key = m[1].replace(/\\"/g, '"');
    const wanted = new Set([...key.matchAll(HOLES)].map((h) => h[1]));
    if (!wanted.size) continue;
    const given = names(m[2]);
    if (given === null) continue; // a shape this cannot read; leave it to a person
    const missing = [...wanted].filter((h) => !given.has(h));
    const spare = [...given].filter((h) => !wanted.has(h));
    if (!missing.length && !spare.length) continue;
    const where = `${relative(root, path)}:${code.slice(0, m.index).split("\n").length}`;
    for (const h of missing) {
      console.log(`  hole      ${where}`);
      console.log(`            {${h}} is in the sentence and was not passed — it reaches the screen verbatim`);
      mismatched++;
    }
    for (const h of spare) {
      console.log(`  hole      ${where}`);
      console.log(`            passed as {${h}}, which the sentence does not name`);
      mismatched++;
    }
  }
}

console.log();
for (const s of prose) console.log(`  english   ${JSON.stringify(s)}`);
for (const c of composed) {
  console.log(`  composed  ${c.where}`);
  console.log(`            ${c.s}`);
  console.log(`            built at runtime, so the lookup misses and it stays English`);
}

console.log(
  `\n  ${keys.length} keys, ${stale} stale, ${drifted} drifted, ` +
    `${composed.length} composed, ${mismatched} bad holes · ` +
    `${shown.size} strings reach the screen, ${shown.size - untranslated.length} translated`,
);
console.log(
  `  ${untranslated.length - prose.length} untranslated strings are brands, ` +
    `event names and values to paste — left alone on purpose.\n`,
);

if (stale || drifted || prose.length || composed.length || mismatched) {
  console.error(
    "  Fix the table or the sentence; do not add a second spelling of a key.\n" +
      "  A composed sentence belongs in t() with a {hole}, not in the template.\n",
  );
  process.exit(1);
}

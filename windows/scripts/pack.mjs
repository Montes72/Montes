// The portable distribution: Montes.exe, the relay it installs for Claude Code,
// and a zip of the two.
//
// There is an installer too — `npm run bundle` builds the NSIS setup.exe and this
// script copies it out beside the zip — but it is not the only way to run Montes,
// and the zip is what a user is told to download when the installer is refused.
// An unsigned installer unpacking its payload into temp is what Defender flagged
// as Trojan:Win32/WacatacH!ml, so both are built and both are named in the notes.
//
// The zip is written here rather than by a dependency: it is one hundred lines,
// and a build tool that cannot run without an install of its own is not much of a
// build tool.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Two toolchains both build into this project, and neither always writes to
// `target/release`: MSVC does when it is the default host, but a build given an
// explicit `--target` lands in `target/<triple>/release` instead. So the question
// is not "which toolchain is preferred" but "which montes.exe is the one just
// built".
//
// Existence is the wrong test, and it was wrong in a way that looked like the
// user's mistake: an old explicit-target build sitting in the tree made this
// pick a day-old exe, and the staleness check further down then failed with
// "rebuild before packing" immediately after a successful rebuild. Newest wins;
// MONTES_TARGET_DIR overrides when that is still not what you meant.
const releaseDir = (() => {
  if (process.env.MONTES_TARGET_DIR) return process.env.MONTES_TARGET_DIR;
  const candidates = [
    join(root, "target", "release"),
    ...["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"]
      .map((triple) => join(root, "target", triple, "release")),
  ].filter((dir) => existsSync(join(dir, "montes.exe")));
  if (candidates.length === 0) return join(root, "target", "release");
  return candidates.sort(
    (a, b) => statSync(join(b, "montes.exe")).mtimeMs - statSync(join(a, "montes.exe")).mtimeMs,
  )[0];
})();
const outDir = join(root, "release");
const { version } = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);

/** What goes in the zip, and what is copied out beside it. Order is read order. */
const CONTENTS = [
  // A console subsystem here would put a black box over the island on launch.
  { from: join(releaseDir, "montes.exe"), as: "Montes.exe", subsystem: "gui" },
  // The opposite on purpose: Claude Code spawns the relay and reads what it
  // prints, inside a terminal that already owns a console.
  { from: join(releaseDir, "montes-hook.exe"), as: "montes-hook.exe", subsystem: "console" },
  // webview2-com-sys builds this and drops it beside the exe, because the GNU
  // toolchain links WebView2Loader dynamically where MSVC links it statically.
  // Ship it without this and a GNU build dies with STATUS_DLL_NOT_FOUND before it
  // can log a single line - which is exactly how that was found. An MSVC build
  // does not produce one, so shipping it there would only be dead weight.
  ...(existsSync(join(releaseDir, "WebView2Loader.dll"))
    ? [{ from: join(releaseDir, "WebView2Loader.dll"), as: "WebView2Loader.dll" }]
    : []),
];

const FOLDER = "Montes";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ── Check what we are about to ship ──────────────────────────────────────────

/**
 * Reads just enough of the PE header to confirm the artifact is the one the
 * release notes describe. Both checks have caught real mistakes: an x86 build
 * from the wrong toolchain, and a console build that flashes a black box at
 * everyone who starts it.
 */
function describePe(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("no MZ header");
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) throw new Error("no PE signature");
  const machine = buf.readUInt16LE(pe + 4);
  const subsystem = buf.readUInt16LE(pe + 24 + 68); // 68 bytes into the optional header
  const arch =
    machine === 0x8664 ? "x64" : machine === 0x14c ? "x86" : `0x${machine.toString(16)}`;
  const gui =
    subsystem === 2 ? "gui" : subsystem === 3 ? "console" : `subsystem ${subsystem}`;
  return { arch, gui };
}

let shipped = null;
for (const { from, as, subsystem } of CONTENTS) {
  if (!existsSync(from)) {
    fail(`Missing ${as} — expected it at\n    ${from}\n  Build it first: npm run pack`);
  }
  let described;
  try {
    described = describePe(readFileSync(from));
  } catch (e) {
    fail(`${as} is not a Windows executable: ${e.message}`);
  }
  if (described.arch !== "x64") fail(`${as} is ${described.arch}; this build is x64 only.`);
  if (subsystem && described.gui !== subsystem) {
    fail(`${as} is a ${described.gui} application; it should be ${subsystem}.`);
  }
  if (as === CONTENTS[0].as) shipped = described;
}

// The twenty-eight sounds are baked into the binary rather than shipped as files,
// so a build that lost them is a binary that is simply silent. The assets are
// stored compressed, which means there is nothing to look for inside the exe —
// so the check is made where the mistake can still happen: in the build output.
const sharedSounds = wavsIn(join(root, "shared", "sounds"));
const builtSounds = wavsIn(join(root, "dist", "sounds"));
const soundCount = Object.keys(sharedSounds).length;
if (soundCount === 0) {
  fail("shared/sounds is empty — run: npm run sounds");
}
const missing = Object.keys(sharedSounds).filter(
  (name) => builtSounds[name] !== sharedSounds[name],
);
if (missing.length) {
  fail(
    `${missing.length} of ${soundCount} sounds never made it into ` +
      `dist/sounds (${missing.slice(0, 3).join(", ")}…).\n` +
      `  Run the whole build, not just vite: npm run build`,
  );
}

// A binary older than the front end it should carry means `cargo build` ran
// before `vite build`, and the app would quietly serve the previous island.
const built = statSync(CONTENTS[0].from).mtimeMs;
for (const file of ["index.html", "settings.html"]) {
  if (statSync(join(root, "dist", file)).mtimeMs > built) {
    fail(`dist/${file} is newer than Montes.exe — rebuild before packing.`);
  }
}

/** Every `.wav` in a folder, as name → byte length, so copies can be compared. */
function wavsIn(dir) {
  if (!existsSync(dir)) return {};
  const found = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".wav")) found[name] = statSync(join(dir, name)).size;
  }
  return found;
}

// ── ZIP ──────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packs a timestamp into two words, the time of day with 2-second steps. */
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A stored-or-deflated zip. Entries are compressed in memory first so every
 * size and checksum is known before a byte of the archive is laid down, which is
 * what keeps the central directory consistent.
 */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data, mtime } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // If deflating does not help, store it. The reader gets identical bytes
    // either way, and a stored entry is not a mysterious problem to debug.
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(data);
    const { time, date } = dosStamp(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk number
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries in total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment

  return Buffer.concat([...locals, directory, end]);
}

// ── Write it out ─────────────────────────────────────────────────────────────

// Only the GNU build needs the DLL shipped, so only it is told to keep it.
const shipsWebView2 = CONTENTS.some((c) => c.as === "WebView2Loader.dll");
const webviewNote = shipsWebView2
  ? `
  WebView2Loader.dll  the browser engine Montes is built on. It has to stay in
                      this folder; without it Montes does not start.
`
  : "";

const readme = `Montes ${version} — portable build for Windows 10/11 x64

  Montes.exe          the assistant. Double-click it. It sits at the top of your
                      screen and installs nothing anywhere.
  montes-hook.exe     the relay Montes sets up for Claude Code. It does nothing on
                      its own — Montes copies it into %LOCALAPPDATA%\\Montes\\bin on
                      first launch.
${webviewNote}
Keep the files in this folder together. Nothing here is written to, so the whole
folder can live on a USB stick.

Getting started
  1. Unzip the whole folder.
  2. Run Montes.exe. If Windows SmartScreen objects, choose More info → Run
     anyway. This build is not code-signed, so Windows cannot confirm who made
     it — nothing about the program is hidden by that warning.
  3. Montes registers its Claude Code hooks on first launch.

Everything it writes lives in %LOCALAPPDATA%\\Montes and %APPDATA%\\Montes. No
registry entries, no services, no startup items. Delete the folder and the
program is gone.

Licence: MIT — see LICENSE. Forked from https://github.com/Louis-CFM/coucou
`;

// The app is single-instance, and the loose copy in `release/` is what a tester
// runs. If it is open now, the copy below fails with EBUSY on a file it cannot
// replace, and the smoke test afterwards would launch a second copy that hands
// its arguments over and exits without reaching setup. Both failures read like
// a broken build, so check first and say what is actually wrong.
const alreadyRunning = spawnSync("tasklist", ["/FI", "IMAGENAME eq Montes.exe", "/NH"], {
  encoding: "utf8",
  windowsHide: true,
});
if (alreadyRunning.stdout && /Montes\.exe/i.test(alreadyRunning.stdout)) {
  fail(
    "Montes.exe is running, so this build cannot be written or smoke-tested.\n" +
      "  Close it (tray icon, or Task Manager) and run the pack again.",
  );
}

mkdirSync(outDir, { recursive: true });

// `release/` is never cleaned between runs, so a file that has stopped being part
// of the distribution keeps sitting there looking exactly like one that is still
// part of it. The GNU-only WebView2Loader.dll is the one that bites: an MSVC
// build stops shipping it and the zip stops containing it, but the loose copy
// stays — so `release/` disagreed with the archive beside it.
//
// Only names this script writes are considered, so anything a person has put in
// there is left alone.
const ours = /^Montes\.exe$|^montes-hook\.exe$|^WebView2Loader\.dll$|^README\.txt$|^Montes-Windows-.*\.(zip|exe)$/;
const current = new Set([
  ...CONTENTS.map((c) => c.as),
  "README.txt",
  `Montes-Windows-${version}-portable.zip`,
  "Montes-Windows-portable.zip",
  `Montes-Windows-${version}-setup.exe`,
]);
for (const name of readdirSync(outDir)) {
  if (ours.test(name) && !current.has(name)) {
    rmSync(join(outDir, name), { force: true });
    console.log(`  removed stale ${name}`);
  }
}

const entries = [];
for (const { from, as } of CONTENTS) {
  const mtime = statSync(from).mtime;
  entries.push({ name: `${FOLDER}/${as}`, data: readFileSync(from), mtime });
  // The loose copy is the runnable folder on its own, so a tester does not have
  // to unzip anything before trying a build.
  copyFileSync(from, join(outDir, as));
}
entries.push({
  name: `${FOLDER}/README.txt`,
  data: Buffer.from(readme, "utf8"),
  mtime: new Date(),
});

// ── Smoke test ───────────────────────────────────────────────────────────────
//
// A folder can be missing a DLL and still zip, copy and hash perfectly. The only
// way to know it works is to start it, so do that here — against the loose copy
// in `release/`, which holds byte-for-byte what is about to be archived.
//
// Six seconds is generous: setup registers hooks and installs the relay long
// before it, and an app that dies of a missing DLL dies in milliseconds.
const logPath = join(
  process.env.LOCALAPPDATA || join(root, ".."),
  "Montes",
  "montes.log",
);
// Only what this run adds, so a build check never eats the user's log history.
const logBefore = existsSync(logPath) ? statSync(logPath).size : 0;

const smoke = spawnSync(join(outDir, CONTENTS[0].as), [], { timeout: 6000, windowsHide: true });
let smokeNote;
if (smoke.error && smoke.error.code === "ETIMEDOUT") {
  smokeNote = "started, still running after 6 s";
} else if (smoke.error) {
  fail(`Montes.exe could not be launched at all: ${smoke.error.code}`);
} else if (smoke.status !== 0) {
  const code = smoke.status >>> 0;
  fail(
    `Montes.exe quit immediately with 0x${code.toString(16).toUpperCase()}` +
      (code === 0xc0000135
        ? " — STATUS_DLL_NOT_FOUND: something it needs is not in the folder."
        : code === 0xc0000005
          ? " — STATUS_ACCESS_VIOLATION: it crashed on startup."
          : "."),
  );
} else {
  smokeNote = "exited cleanly";
}

// Starting is not the same as working. A build missing the `custom-protocol`
// feature starts perfectly, draws its window, writes its log — and fills both
// windows with "localhost refused to connect", because its webviews are still
// aimed at the Vite dev server. The app reports which page source it was built
// against; read that back out of the log this run just wrote.
const written = existsSync(logPath)
  ? readFileSync(logPath).subarray(logBefore).toString("utf8")
  : "";
if (!written.includes("Montes") || !written.includes("started")) {
  fail(
    "Montes.exe started but wrote nothing to its log.\n" +
      `  Look in %LOCALAPPDATA%\\Montes\\montes.log — if it is not there either,\n` +
      "  the app never reached setup.",
  );
}
if (written.includes("DEV SERVER")) {
  fail(
    "This binary was built against the Vite dev server, so both windows would\n" +
      "  open \"localhost refused to connect\". Rebuild with the feature:\n" +
      "    cargo build --release --features montes/custom-protocol -p montes -p montes-hook",
  );
}
smokeNote += ", pages from bundle";

const archive = zip(entries);
// The rolling name always points at the newest release; the versioned one stays
// put, which is what a download page needs to link to.
const names = [
  `Montes-Windows-${version}-portable.zip`,
  "Montes-Windows-portable.zip",
];
for (const name of names) writeFileSync(join(outDir, name), archive);

// ── The installer, if one was built ──────────────────────────────────────────

// `npm run bundle` writes the NSIS installer to target/<toolchain>/release/
// bundle/nsis/, which is inside target/ and so does not travel with the release.
// It is copied out under the name the release page and the workflow link to.
//
// Not an error when it is missing: `npm run pack` builds with --no-bundle on
// purpose, so a portable-only build is a real thing somebody can want. Saying so
// beats failing on an artifact nobody asked for.
const installer = (() => {
  const dir = join(releaseDir, "bundle", "nsis");
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).filter((n) => n.endsWith("-setup.exe"));
  if (found.length === 0) return null;
  // More than one means several versions were built into the same target dir;
  // the newest mtime is the one this run made.
  found.sort(
    (a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs,
  );
  return join(dir, found[0]);
})();
const installerName = installer
  ? `Montes-Windows-${version}-setup.exe`
  : null;
if (installer) {
  copyFileSync(installer, join(outDir, installerName));
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const { arch, gui } = shipped;
const sha = createHash("sha256").update(archive).digest("hex");

console.log("\n  Portable build ready\n");
console.log(`    version    ${version}   ·   ${arch} ${gui}`);
console.log(`    smoke      ${smokeNote}`);
console.log(`    folder     ${outDir}`);
for (const { as } of CONTENTS) {
  console.log(`      ${as.padEnd(20)}${mb(statSync(join(outDir, as)).size)}`);
}
console.log(`      ${"README.txt".padEnd(20)}${mb(Buffer.byteLength(readme))}   (in the zip only)`);
console.log();
for (const name of names) {
  console.log(`    ${name}`);
  console.log(`      ${mb(archive.length)}   sha256 ${sha.slice(0, 32)}…`);
}
if (installerName) {
  const size = statSync(join(outDir, installerName)).size;
  const digest = createHash("sha256")
    .update(readFileSync(join(outDir, installerName)))
    .digest("hex");
  console.log(`    ${installerName}`);
  console.log(`      ${mb(size)}   sha256 ${digest.slice(0, 32)}…   (unsigned)`);
} else {
  console.log("    no installer   (npm run bundle builds the NSIS setup.exe)");
}
console.log();

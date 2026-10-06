// Tests for tools/share-encrypt.mjs, run against temporary repository roots.
// Run: node --test "tools/test/*.test.mjs"

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ID_PATTERN, PASSWORD_ALPHABET, decryptArchive, deriveLocator } from "../../share/assets/crypto-format.js";
import {
    INDEX_HTML,
    generatePassword,
    readmeImageRefs,
    run,
    selectProjectFiles,
} from "../share-encrypt.mjs";

const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDir() {
    const d = mkdtempSync(path.join(tmpdir(), "share-encrypt-test-"));
    temps.push(d);
    return d;
}

function put(root, rel, content = rel) {
    const file = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
}

/** Fake terminal: records output, answers confirm() from a queue (default "no"). */
function fakeIo({ interactive = false, answers = [] } = {}) {
    const io = {
        interactive,
        out: [],
        questions: [],
        log: (...a) => io.out.push(a.join(" ")),
        warn: (...a) => io.out.push(a.join(" ")),
        async confirm(q) {
            io.questions.push(q);
            return answers.length ? answers.shift() : false;
        },
        text: () => io.out.join("\n"),
    };
    return io;
}

/** Repository root with .gitignore and one registered-able project folder. */
function makeRepo() {
    const root = tempDir();
    put(root, ".gitignore", "local_share/\n");
    put(root, "local_share/demo/demo.kicad_pro", "{}");
    put(root, "local_share/demo/demo.kicad_sch", "(kicad_sch)");
    put(root, "local_share/demo/demo.kicad_pcb", "(kicad_pcb)");
    put(root, "local_share/demo/README.md", "# Demo\n");
    return root;
}

/** Register "demo" non-interactively via --set-source (no copy happens without --sync). */
async function registerDemo(root) {
    await run(["--set-source", "demo", path.join(root, "nowhere")], { rootDir: root, io: fakeIo() });
    return manifest(root).projects.demo;
}

const manifest = (root) => JSON.parse(readFileSync(path.join(root, "local_share", "manifest.json"), "utf8"));
const dataPath = (root, id) => path.join(root, "share", "data", `${id}.bin`);
const dataBin = (root, id) => readFileSync(dataPath(root, id));

// ---------------------------------------------------------------------------

test("passwords: 20 chars from the allowed alphabet, all classes present", () => {
    const allowed = new Set(PASSWORD_ALPHABET);
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
        const p = generatePassword();
        assert.equal(p.length, 20);
        assert.ok([...p].every((c) => allowed.has(c)), p);
        assert.match(p, /[A-Z]/);
        assert.match(p, /[a-z]/);
        assert.match(p, /[0-9]/);
        assert.match(p, /[!#$%*+\-=?@^_]/);
        seen.add(p);
    }
    assert.equal(seen.size, 500);
    assert.equal(PASSWORD_ALPHABET, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%*+-=?@^_");
});

test("file ids are derived from name + password (32 hex chars), not random", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    assert.match(p.id, ID_PATTERN);
    assert.match(p.id, /^[0-9a-f]{32}$/);
    assert.equal(p.id, await deriveLocator("demo", p.password));
    assert.notEqual(p.id, await deriveLocator("demo", p.password + "x"));
    assert.notEqual(p.id, await deriveLocator("Demo", p.password));
});

test("first run creates id, password, index.html and a decryptable data.bin", async () => {
    const root = makeRepo();
    const io = fakeIo();
    const p = await registerDemo(root);
    await run([], { rootDir: root, io });
    const m = manifest(root);
    assert.match(m.projects.demo.id, ID_PATTERN);
    assert.equal(m.projects.demo.id, p.id);
    assert.match(m.projects.demo.hash, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(path.join(root, "share", "index.html"), "utf8"), INDEX_HTML);
    assert.ok(existsSync(dataPath(root, p.id)));
    assert.ok(!existsSync(path.join(root, "share", p.id)), "no per-project directory");
    assert.ok(!INDEX_HTML.startsWith("---"), "no Jekyll front matter");
    const files = await decryptArchive({ projectName: "demo", password: p.password, data: dataBin(root, p.id) });
    assert.deepEqual([...files.keys()].sort(), ["README.md", "demo.kicad_pcb", "demo.kicad_pro", "demo.kicad_sch"]);
    assert.ok(!io.text().includes(p.password), "normal runs do not print the password");
});

test("unchanged content is skipped; changes re-encrypt with the same id and password", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    await run([], { rootDir: root, io: fakeIo() });
    const first = dataBin(root, p.id);

    const io2 = fakeIo();
    const s2 = await run([], { rootDir: root, io: io2 });
    assert.equal(s2.results.demo, "unchanged");
    assert.match(io2.text(), /変更なし（スキップ）/);
    assert.deepEqual(dataBin(root, p.id), first);

    put(root, "local_share/demo/README.md", "# Demo\nedited\n");
    const io3 = fakeIo();
    const s3 = await run([], { rootDir: root, io: io3 });
    assert.equal(s3.results.demo, "updated");
    assert.match(io3.text(), /\[更新\]/);
    const m = manifest(root);
    assert.equal(m.projects.demo.id, p.id);
    assert.equal(m.projects.demo.password, p.password);
    assert.notDeepEqual(dataBin(root, p.id), first);
    const files = await decryptArchive({ projectName: "demo", password: p.password, data: dataBin(root, p.id) });
    assert.equal(new TextDecoder().decode(files.get("README.md")), "# Demo\nedited\n");
});

test("--force re-encrypts unchanged content (fresh salt/nonce)", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    await run([], { rootDir: root, io: fakeIo() });
    const before = dataBin(root, p.id);
    const s = await run(["--force"], { rootDir: root, io: fakeIo() });
    assert.equal(s.results.demo, "forced");
    assert.notDeepEqual(dataBin(root, p.id), before);
});

test("--only limits processing to the named project", async () => {
    const root = makeRepo();
    put(root, "local_share/other/other.kicad_sch", "(kicad_sch)");
    await registerDemo(root);
    await run(["--set-source", "other", "/nonexistent"], { rootDir: root, io: fakeIo() });
    const s = await run(["--only", "demo"], { rootDir: root, io: fakeIo() });
    assert.deepEqual(Object.keys(s.results), ["demo"]);
    assert.ok(!existsSync(dataPath(root, manifest(root).projects.other.id)));
});

test("--rotate-password changes password and file id; the old file is kept until confirmed", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    await run([], { rootDir: root, io: fakeIo() });
    const io = fakeIo();
    const s = await run(["--rotate-password", "demo"], { rootDir: root, io });
    const m = manifest(root).projects.demo;
    assert.notEqual(m.password, p.password);
    assert.notEqual(m.id, p.id);
    assert.equal(m.id, await deriveLocator("demo", m.password));
    assert.equal(s.results.demo, "new");
    assert.ok(io.text().includes(m.password), "new password is shown once");
    await decryptArchive({ projectName: "demo", password: m.password, data: dataBin(root, m.id) });
    assert.ok(existsSync(dataPath(root, p.id)), "old file not deleted without confirmation");
    assert.ok(s.staleKept.includes(`data/${p.id}.bin`));
    const s2 = await run([], { rootDir: root, io: fakeIo({ interactive: true, answers: [true] }) });
    assert.deepEqual(s2.staleDeleted, [`data/${p.id}.bin`]);
    assert.ok(!existsSync(dataPath(root, p.id)));
});

test("--show-password prints the stored password only when asked", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    const io = fakeIo();
    await run(["--show-password", "demo"], { rootDir: root, io });
    assert.ok(io.text().includes(p.password));
});

test("unregistered folders: warning only when non-interactive, registered on 'yes'", async () => {
    const root = makeRepo();
    const io = fakeIo();
    await run([], { rootDir: root, io });
    assert.match(io.text(), /not registered/);
    assert.ok(!existsSync(path.join(root, "local_share", "manifest.json")) || !manifest(root).projects.demo);

    const io2 = fakeIo({ interactive: true, answers: [true] });
    const s = await run([], { rootDir: root, io: io2 });
    assert.deepEqual(s.registered, ["demo"]);
    assert.ok(io2.text().includes(manifest(root).projects.demo.password), "new password shown on creation");
    assert.equal(s.results.demo, "new");
});

test("invalid project names are rejected", async () => {
    const root = makeRepo();
    await assert.rejects(run(["--set-source", "bad name", "/x"], { rootDir: root, io: fakeIo() }), /invalid project name/);
    await assert.rejects(run(["--set-source", "a.b", "/x"], { rootDir: root, io: fakeIo() }), /invalid project name/);
    const io = fakeIo();
    await run(["--set-source", "a!#$%+-=@^_Z9", "/x"], { rootDir: root, io });
    assert.ok(manifest(root).projects["a!#$%+-=@^_Z9"]);
});

test("unused files are never deleted without an explicit yes", async () => {
    const root = makeRepo();
    await registerDemo(root);
    const staleFile = `data/${"a".repeat(32)}.bin`;
    const legacyDir = "zzzzzzzzzzzzzzzzzzzz"; // old share/<id>/ layout
    put(root, `share/${staleFile}`, "old");
    put(root, `share/${legacyDir}/data.bin`, "old");
    put(root, "share/data/notes.txt", "unexpected");
    put(root, "share/notes/readme.txt", "not an id");
    put(root, "share/assets/viewer.js", "//");

    const s1 = await run([], { rootDir: root, io: fakeIo() }); // non-interactive
    assert.ok(existsSync(path.join(root, "share", staleFile)));
    assert.ok(existsSync(path.join(root, "share", legacyDir)));
    assert.ok(s1.staleKept.includes(staleFile) && s1.staleKept.includes(`${legacyDir}/`));

    const io2 = fakeIo({ interactive: true, answers: [] }); // default answer: No
    await run([], { rootDir: root, io: io2 });
    assert.ok(existsSync(path.join(root, "share", staleFile)));
    assert.equal(io2.questions.length, 1);

    const s3 = await run(["--yes"], { rootDir: root, io: fakeIo({ interactive: true, answers: [true] }) });
    assert.deepEqual(s3.staleDeleted.sort(), [staleFile, `${legacyDir}/`].sort());
    assert.ok(!existsSync(path.join(root, "share", staleFile)));
    assert.ok(!existsSync(path.join(root, "share", legacyDir)));
    assert.ok(existsSync(path.join(root, "share", "data", "notes.txt")), "unexpected files are never deleted");
    assert.ok(existsSync(path.join(root, "share", "notes")), "non-id directories are never deleted");
    assert.ok(existsSync(path.join(root, "share", "assets")));
    assert.ok(existsSync(path.join(root, "share", "index.html")));
    assert.ok(existsSync(dataPath(root, manifest(root).projects.demo.id)));
});

test("--yes alone does not delete unused files", async () => {
    const root = makeRepo();
    await registerDemo(root);
    put(root, `share/data/${"b".repeat(32)}.bin`, "old");
    await run(["--yes"], { rootDir: root, io: fakeIo() });
    assert.ok(existsSync(path.join(root, "share", "data", `${"b".repeat(32)}.bin`)));
});

test("manifest entries of the old layout (random ids) are migrated to derived file ids", async () => {
    const root = makeRepo();
    const password = "Aa1!Aa1!Aa1!Aa1!Aa1!";
    put(root, "local_share/manifest.json", JSON.stringify({ version: 1, projects: { demo: { id: "oldrandomid000000000", password, hash: "x".repeat(64) } } }));
    put(root, "share/oldrandomid000000000/data.bin", "old");
    put(root, "share/oldrandomid000000000/index.html", "old");
    const io = fakeIo();
    const s = await run([], { rootDir: root, io });
    const m = manifest(root).projects.demo;
    assert.equal(m.id, await deriveLocator("demo", password));
    assert.equal(m.password, password, "password is kept");
    assert.equal(s.results.demo, "new");
    assert.match(io.text(), /\[file id\] demo: oldrandomid000000000 -> [0-9a-f]{32}/);
    await decryptArchive({ projectName: "demo", password, data: dataBin(root, m.id) });
    assert.ok(s.staleKept.includes("oldrandomid000000000/"), "old directory offered for deletion, not deleted");
});

// --- selection / sync ----------------------------------------------------------

function makeSource() {
    const src = tempDir();
    put(src, "board.kicad_pro", "{}");
    put(src, "board.kicad_sch", "(kicad_sch root)");
    put(src, "board.kicad_pcb", "(kicad_pcb)");
    put(src, "sheets/power.kicad_sch", "(kicad_sch power)");
    put(src, "sheets/deep/io.kicad_sch", "(kicad_sch io)");
    put(
        src,
        "README.md",
        "# B\n![a](img/a.png)\n![s](<img/with space.svg>)\n<img src=\"img/b.jpg\">\n![m](img/missing.png)\n![r][ref]\n![x](https://example.com/x.png)\n![up](../outside.png)\n\n[ref]: img/c.webp\n",
    );
    put(src, "img/a.png", "png");
    put(src, "img/with space.svg", "<svg/>");
    put(src, "img/b.jpg", "jpg");
    put(src, "img/c.webp", "webp");
    put(src, "img/unreferenced.png", "nope");
    // must never be copied
    put(src, "board-backups/board-2026.zip", "zip");
    put(src, "board-backups/board.kicad_sch", "(old)");
    put(src, "_autosave-board.kicad_sch", "(autosave)");
    put(src, "board.kicad_sch.lck", "lock");
    put(src, "~board.kicad_pcb.lck", "lock");
    put(src, "fp-info-cache", "cache");
    put(src, "board.kicad_prl", "{}");
    put(src, "board.kicad_pcb-bak", "bak");
    put(src, "board.kicad_sch-bak", "bak");
    put(src, ".git/config", "[core]");
    put(src, ".git/x.kicad_sch", "(git)");
    put(src, "gerber/board-F_Cu.gbr", "G04");
    put(src, "gerber/board.kicad_pcb", "(copy)");
    put(src, "production/board.kicad_pcb", "(copy)");
    put(src, "notes.txt", "txt");
    return src;
}

const EXPECTED_SELECTION = [
    "README.md",
    "board.kicad_pcb",
    "board.kicad_pro",
    "board.kicad_sch",
    "img/a.png",
    "img/b.jpg",
    "img/c.webp",
    "img/with space.svg",
    "sheets/deep/io.kicad_sch",
    "sheets/power.kicad_sch",
];

test("README image references are parsed", () => {
    const refs = readmeImageRefs('![a](x.png "t") ![b](<y z.png>) <img alt="c" src=\'w.gif\'>\n[r]: v.svg\n');
    for (const r of ["x.png", "y z.png", "w.gif", "v.svg"]) {
        assert.ok(refs.includes(r), r);
    }
});

test("selection excludes backups, temp files, VCS and fabrication outputs", () => {
    assert.deepEqual(selectProjectFiles(makeSource()), EXPECTED_SELECTION);
});

test("--sync copies only the selected files, preserving sheet sub-directories", async () => {
    const root = makeRepo();
    const src = makeSource();
    await run(["--set-source", "board", src], { rootDir: root, io: fakeIo() });
    const io = fakeIo();
    await run(["--sync", "--yes", "--only", "board"], { rootDir: root, io });
    const dest = path.join(root, "local_share", "board");
    const copied = [];
    const walk = (d, pre = "") => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const rel = pre + e.name;
            e.isDirectory() ? walk(path.join(d, e.name), rel + "/") : copied.push(rel);
        }
    };
    walk(dest);
    assert.deepEqual(copied.sort(), EXPECTED_SELECTION);
    assert.equal(readFileSync(path.join(dest, "sheets", "deep", "io.kicad_sch"), "utf8"), "(kicad_sch io)");

    // The encrypted archive keeps the relative sheet paths.
    const p = manifest(root).projects.board;
    const files = await decryptArchive({ projectName: "board", password: p.password, data: dataBin(root, p.id) });
    assert.deepEqual([...files.keys()].sort(), EXPECTED_SELECTION);
});

test("--sync lists add/overwrite/unchanged and never deletes destination-only files", async () => {
    const root = makeRepo();
    const src = makeSource();
    await run(["--set-source", "board", src], { rootDir: root, io: fakeIo() });
    await run(["--sync", "--yes", "--only", "board"], { rootDir: root, io: fakeIo() });

    put(src, "board.kicad_sch", "(kicad_sch root v2)");
    put(src, "sheets/new.kicad_sch", "(kicad_sch new)");
    rmSync(path.join(src, "sheets", "power.kicad_sch"));

    const io = fakeIo();
    const s = await run(["--sync", "--yes", "--only", "board"], { rootDir: root, io });
    const text = io.text();
    assert.match(text, /add\s+sheets\/new\.kicad_sch/);
    assert.match(text, /overwrite\s+board\.kicad_sch/);
    assert.match(text, /unchanged\s+board\.kicad_pcb/);
    assert.match(text, /not in source any more/);
    assert.deepEqual(s.syncWarnings.board, ["sheets/power.kicad_sch"]);
    const dest = path.join(root, "local_share", "board");
    assert.ok(existsSync(path.join(dest, "sheets", "power.kicad_sch")), "kept");
    assert.equal(readFileSync(path.join(dest, "board.kicad_sch"), "utf8"), "(kicad_sch root v2)");
    assert.equal(s.results.board, "updated");
});

test("--sync without --yes copies nothing when non-interactive or when the answer is No", async () => {
    const root = makeRepo();
    const src = makeSource();
    await run(["--set-source", "board", src], { rootDir: root, io: fakeIo() });
    await run(["--sync", "--only", "board"], { rootDir: root, io: fakeIo() });
    assert.ok(!existsSync(path.join(root, "local_share", "board")));

    const io = fakeIo({ interactive: true, answers: [false] });
    await run(["--sync", "--only", "board"], { rootDir: root, io });
    assert.ok(!existsSync(path.join(root, "local_share", "board")));
    assert.equal(io.questions.length, 1);
});

test("source paths support ~ expansion", async () => {
    const { expandUserPath } = await import("../share-encrypt.mjs");
    const { homedir } = await import("node:os");
    assert.equal(expandUserPath("~"), homedir());
    assert.equal(expandUserPath("~/kicad/x"), path.join(homedir(), "kicad", "x"));
    assert.equal(expandUserPath("relative/dir"), path.resolve("relative/dir"));
});

// --- --list / URLs -------------------------------------------------------------

test("--list shows the common URL from CNAME, file ids and update state, never passwords", async () => {
    const root = makeRepo();
    put(root, "CNAME", "example.org\n");
    const p = await registerDemo(root);

    const io1 = fakeIo();
    const s1 = await run(["--list"], { rootDir: root, io: io1 });
    assert.deepEqual(s1.results, {}, "--list alone does not encrypt");
    assert.ok(!existsSync(dataPath(root, p.id)));
    assert.match(io1.text(), /share URL \(all projects\): https:\/\/example\.org\/share\//);
    assert.match(io1.text(), new RegExp(`demo\\s+share/data/${p.id}\\.bin\\s+\\(not encrypted yet\\)`));
    assert.match(io1.text(), /source: /);
    assert.ok(!io1.text().includes(p.password));

    await run([], { rootDir: root, io: fakeIo() });
    const io2 = fakeIo();
    const s2 = await run(["--list"], { rootDir: root, io: io2 });
    assert.match(io2.text(), /updated \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.equal(s2.list[0].id, p.id);
    assert.ok(!JSON.stringify(s2.list).includes(p.password));
    assert.ok(!io2.text().includes(p.password));
});

test("the URL falls back to /share/ without CNAME; shown with --show-password and on creation", async () => {
    const root = makeRepo();
    const io = fakeIo();
    await run(["--set-source", "demo", "/x"], { rootDir: root, io });
    const p = manifest(root).projects.demo;
    assert.ok(io.text().includes("url:      /share/"), "URL shown on creation");
    assert.ok(io.text().includes(`file id:  ${p.id}`));
    const io2 = fakeIo();
    await run(["--show-password", "demo"], { rootDir: root, io: io2 });
    assert.ok(io2.text().includes("url:      /share/"));
    assert.ok(io2.text().includes(`file id:  ${p.id}`));
    assert.ok(io2.text().includes(p.password));
});

// --- Node.js version guard -------------------------------------------------------

test("Node.js version guard accepts 22.7+, 23+ and 20.19+, rejects older versions", async () => {
    const { isSupportedNodeVersion, missingFeatures } = await import("../node-version.mjs");
    for (const ok of ["v22.7.0", "v22.23.2", "v23.0.0", "v24.1.0", "v26.0.0", "v20.19.0", "v20.20.1", "22.7.0"]) {
        assert.ok(isSupportedNodeVersion(ok), ok);
    }
    for (const bad of ["v22.6.0", "v22.0.0", "v21.7.3", "v20.18.3", "v20.0.0", "v18.20.4", "v16.20.2", "v12.22.0", "", "garbage"]) {
        assert.ok(!isSupportedNodeVersion(bad), bad);
    }
    assert.ok(isSupportedNodeVersion(process.version), "the running Node passes");
    assert.deepEqual(missingFeatures(globalThis), []);
    assert.equal(missingFeatures({}).length, 2);
});

test("an unsupported Node.js exits with a clear message before loading crypto-format.js", async () => {
    const { spawnSync } = await import("node:child_process");
    const { pathToFileURL } = await import("node:url");
    const tool = pathToFileURL(path.join(import.meta.dirname, "..", "share-encrypt.mjs")).href;
    // Pretend to be Node 18 by overriding process.version before the tool is loaded.
    const r = spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `Object.defineProperty(process, "version", { value: "v18.20.4" }); await import(${JSON.stringify(tool)});`,
    ], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Node\.js 22\.7\.0 or later .* is required \(running v18\.20\.4\)/);
    assert.ok(!/SyntaxError/.test(r.stderr));
});

// --- symlink safety ----------------------------------------------------------------

test("files reached through symlinks (files, folders or README image paths) are never selected", async () => {
    const { symlinkSync } = await import("node:fs");
    const base = tempDir();
    const src = path.join(base, "src");
    const outside = path.join(base, "outside");
    put(outside, "secret.kicad_sch", "SECRET");
    put(outside, "secret.png", "SECRET");
    put(outside, "dir/x.kicad_sch", "SECRET");
    put(src, "b.kicad_sch", "(kicad_sch)");
    put(src, "real/ok.png", "png");
    put(src, "README.md", "![a](link.png)\n![b](imgs/up/secret.png)\n![c](../outside/secret.png)\n![d](real/ok.png)\n");
    symlinkSync(path.join(outside, "secret.kicad_sch"), path.join(src, "link.kicad_sch"));
    symlinkSync(path.join(outside, "dir"), path.join(src, "linkdir"));
    symlinkSync(path.join(outside, "secret.png"), path.join(src, "link.png"));
    mkdirSync(path.join(src, "imgs"));
    symlinkSync(outside, path.join(src, "imgs", "up"));
    assert.deepEqual(selectProjectFiles(src), ["README.md", "b.kicad_sch", "real/ok.png"]);
});

test("Windows-reserved device names produce a warning", async () => {
    const root = makeRepo();
    const io = fakeIo();
    await run(["--set-source", "CON", "/x"], { rootDir: root, io });
    assert.match(io.text(), /reserved device name/);
});

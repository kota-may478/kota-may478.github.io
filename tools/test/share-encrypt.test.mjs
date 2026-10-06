// Tests for tools/share-encrypt.mjs, run against temporary repository roots.
// Run: node --test "tools/test/*.test.mjs"

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ID_PATTERN, PASSWORD_ALPHABET, decryptArchive } from "../../share/assets/crypto-format.js";
import {
    INDEX_HTML,
    generateId,
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
const dataBin = (root, id) => readFileSync(path.join(root, "share", id, "data.bin"));

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

test("ids: lowercase alphanumerics, >= 16 chars, random", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
        const id = generateId();
        assert.match(id, /^[a-z0-9]{16,}$/);
        assert.match(id, ID_PATTERN);
        assert.ok(!id.startsWith("_") && !id.startsWith("."));
        seen.add(id);
    }
    assert.equal(seen.size, 500);
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
    assert.equal(readFileSync(path.join(root, "share", p.id, "index.html"), "utf8"), INDEX_HTML);
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
    assert.ok(!existsSync(path.join(root, "share", manifest(root).projects.other.id, "data.bin")));
});

test("--rotate-password keeps the id, changes the password and re-encrypts", async () => {
    const root = makeRepo();
    const p = await registerDemo(root);
    await run([], { rootDir: root, io: fakeIo() });
    const io = fakeIo();
    await run(["--rotate-password", "demo"], { rootDir: root, io });
    const m = manifest(root).projects.demo;
    assert.equal(m.id, p.id);
    assert.notEqual(m.password, p.password);
    assert.ok(io.text().includes(m.password), "new password is shown once");
    await assert.rejects(decryptArchive({ projectName: "demo", password: p.password, data: dataBin(root, p.id) }));
    await decryptArchive({ projectName: "demo", password: m.password, data: dataBin(root, p.id) });
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

test("stale ids are never deleted without an explicit yes", async () => {
    const root = makeRepo();
    await registerDemo(root);
    const staleId = "zzzzzzzzzzzzzzzzzzzz";
    put(root, `share/${staleId}/data.bin`, "old");
    put(root, "share/notes/readme.txt", "not an id");
    put(root, "share/assets/viewer.js", "//");

    const s1 = await run([], { rootDir: root, io: fakeIo() }); // non-interactive
    assert.ok(existsSync(path.join(root, "share", staleId)));
    assert.ok(s1.staleKept.includes(staleId));

    const io2 = fakeIo({ interactive: true, answers: [] }); // default answer: No
    await run([], { rootDir: root, io: io2 });
    assert.ok(existsSync(path.join(root, "share", staleId)));
    assert.equal(io2.questions.length, 1);

    const s3 = await run(["--yes"], { rootDir: root, io: fakeIo({ interactive: true, answers: [true] }) });
    assert.deepEqual(s3.staleDeleted, [staleId]);
    assert.ok(!existsSync(path.join(root, "share", staleId)));
    assert.ok(existsSync(path.join(root, "share", "notes")), "non-id directories are never deleted");
    assert.ok(existsSync(path.join(root, "share", "assets")));
    assert.ok(existsSync(path.join(root, "share", manifest(root).projects.demo.id)));
});

test("--yes alone does not delete stale ids", async () => {
    const root = makeRepo();
    await registerDemo(root);
    put(root, "share/yyyyyyyyyyyyyyyyyyyy/data.bin", "old");
    await run(["--yes"], { rootDir: root, io: fakeIo() });
    assert.ok(existsSync(path.join(root, "share", "yyyyyyyyyyyyyyyyyyyy")));
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

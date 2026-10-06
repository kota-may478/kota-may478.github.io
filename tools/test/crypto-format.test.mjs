// Tests for share/assets/crypto-format.js (the same file the browser imports).
// Run: node --test "tools/test/*.test.mjs"

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    DecryptError,
    FORMAT_VERSION,
    FormatError,
    HEADER_LENGTH,
    NONCE_LENGTH,
    SALT_LENGTH,
    decodeArchive,
    decryptArchive,
    encodeArchive,
    encodeCredentials,
    encryptArchive,
    isSafeArchivePath,
    isValidProjectName,
    normalizeInput,
} from "../../share/assets/crypto-format.js";

const enc = new TextEncoder();
const files = new Map([
    ["README.md", enc.encode("# Title\n本文\n")],
    ["proj.kicad_pro", enc.encode("{}")],
    ["proj.kicad_sch", enc.encode("(kicad_sch (version 20260306))")],
    ["sub/child.kicad_sch", enc.encode("(kicad_sch)")],
]);
const NAME = "Proj_1";
const PASS = "aB3!#$%*+-=?@^_xyz9Q";

function same(a, b) {
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
    for (const [k, v] of a) {
        assert.deepEqual(b.get(k), v, k);
    }
}

test("normalizeInput trims whitespace (incl. full-width) and applies NFKC", () => {
    assert.equal(normalizeInput("  proj \t\n"), "proj");
    assert.equal(normalizeInput("　ｐｒｏｊ１　"), "proj1");
    assert.equal(normalizeInput("ＡＢＣ！＃"), "ABC!#");
});

test("normalizeInput preserves case", () => {
    assert.equal(normalizeInput("Proj"), "Proj");
    assert.notEqual(normalizeInput("Proj"), normalizeInput("proj"));
});

test("project names: alphanumerics and !#$%*+-=?@^_ only", () => {
    for (const ok of ["proj", "A-b_c", "x!#$%*+-=?@^_", "0"]) {
        assert.ok(isValidProjectName(ok), ok);
    }
    for (const bad of ["", "a b", "a/b", "a.b", "日本語", "a&b", "x".repeat(65)]) {
        assert.ok(!isValidProjectName(bad), bad);
    }
});

test("credential encoding is unambiguous (length-prefixed)", () => {
    assert.notDeepEqual(encodeCredentials("ab", "c"), encodeCredentials("a", "bc"));
    assert.deepEqual(encodeCredentials(" ａｂ ", "c"), encodeCredentials("ab", "c"));
    assert.throws(() => encodeCredentials("  ", "x"));
});

test("archive encoding is deterministic regardless of insertion order", () => {
    const reversed = new Map([...files].reverse());
    assert.deepEqual(encodeArchive(files), encodeArchive(reversed));
    same(decodeArchive(encodeArchive(files)), files);
});

test("archive paths must be relative and stay inside the root", () => {
    for (const bad of ["../x", "/abs", "a/../b", "a\\b", "", "a//b", "./a"]) {
        assert.ok(!isSafeArchivePath(bad), bad);
        assert.throws(() => encodeArchive(new Map([[bad, new Uint8Array()]])), bad);
    }
    assert.ok(isSafeArchivePath("sub/dir/a.kicad_sch"));
});

test("encrypt/decrypt round trip; header layout", async () => {
    const data = await encryptArchive({ projectName: NAME, password: PASS, files });
    assert.equal(data[0], FORMAT_VERSION);
    assert.ok(data.length > HEADER_LENGTH + 16);
    same(await decryptArchive({ projectName: NAME, password: PASS, data }), files);
});

test("normalised credentials decrypt (spaces, full-width)", async () => {
    const data = await encryptArchive({ projectName: "proj", password: "Pw1!", files });
    const out = await decryptArchive({ projectName: " ｐｒｏｊ ", password: "　Ｐｗ１！", data });
    same(out, files);
});

test("salt and nonce are fresh on every encryption", async () => {
    const a = await encryptArchive({ projectName: NAME, password: PASS, files });
    const b = await encryptArchive({ projectName: NAME, password: PASS, files });
    assert.notDeepEqual(a.subarray(1, 1 + SALT_LENGTH), b.subarray(1, 1 + SALT_LENGTH));
    assert.notDeepEqual(
        a.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + NONCE_LENGTH),
        b.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + NONCE_LENGTH),
    );
    assert.notDeepEqual(a, b);
});

test("wrong password, wrong name, wrong case all fail with DecryptError", async () => {
    const data = await encryptArchive({ projectName: NAME, password: PASS, files });
    await assert.rejects(decryptArchive({ projectName: NAME, password: PASS + "x", data }), DecryptError);
    await assert.rejects(decryptArchive({ projectName: "Proj_2", password: PASS, data }), DecryptError);
    await assert.rejects(decryptArchive({ projectName: NAME.toLowerCase(), password: PASS, data }), DecryptError);
    await assert.rejects(decryptArchive({ projectName: NAME, password: PASS.toLowerCase(), data }), DecryptError);
});

test("tampering with header or ciphertext is detected", async () => {
    const data = await encryptArchive({ projectName: NAME, password: PASS, files });
    for (const index of [1, HEADER_LENGTH - 1, HEADER_LENGTH, data.length - 1]) {
        const copy = data.slice();
        copy[index] ^= 0x01;
        await assert.rejects(decryptArchive({ projectName: NAME, password: PASS, data: copy }), DecryptError);
    }
});

test("unknown version and truncated data are FormatErrors", async () => {
    const data = await encryptArchive({ projectName: NAME, password: PASS, files });
    const v2 = data.slice();
    v2[0] = 2;
    await assert.rejects(decryptArchive({ projectName: NAME, password: PASS, data: v2 }), FormatError);
    await assert.rejects(decryptArchive({ projectName: NAME, password: PASS, data: data.slice(0, 20) }), FormatError);
});

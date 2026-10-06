// Shared by the browser viewer (share-main.js) and the Node tool
// (tools/share-encrypt.mjs), so both sides use exactly the same
// normalisation, key derivation and file format.
//
// Only standard Web APIs are used (Web Crypto, CompressionStream,
// TextEncoder, Blob/Response), which exist in modern browsers and Node >= 20.
//
// Locating a project's file: share/data/<file id>.bin, where
//   file id = hex(PBKDF2-SHA256(credentials, salt = LOCATOR_SALT, 600000 iterations))[0..32]
// The salt is a fixed public string because the browser must compute the
// file name before it has read any file. The encryption key below uses a
// different, per-file random salt, so the public file id says nothing about
// the key.
//
// File layout (format version 1):
//   [0]       format version (1)
//   [1..16]   PBKDF2 salt (16 random bytes, new on every encryption)
//   [17..28]  AES-GCM nonce (12 random bytes, new on every encryption)
//   [29..]    AES-256-GCM ciphertext + 16-byte tag; bytes [0..28] are
//             authenticated as additional data
// The plaintext is a gzip-compressed archive (see encodeArchive).

export const FORMAT_VERSION = 1;
export const SALT_LENGTH = 16;
export const NONCE_LENGTH = 12;
export const HEADER_LENGTH = 1 + SALT_LENGTH + NONCE_LENGTH;
export const PBKDF2_ITERATIONS = 600000;

// Characters allowed in project names and generated passwords.
export const SYMBOLS = "!#$%*+-=?@^_";
export const PASSWORD_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" + SYMBOLS;
export const PASSWORD_LENGTH = 20;
export const PROJECT_NAME_PATTERN = /^[A-Za-z0-9!#$%*+\-=?@^_]{1,64}$/;
// File id: 32 lowercase hex characters (128 bits) derived from the credentials.
export const ID_PATTERN = /^[0-9a-f]{32}$/;
export const LOCATOR_SALT = "kicad-share/locator/v1";
const LOCATOR_BYTES = 16;

const KDF_DOMAIN = "kicad-share/v1";
const ARCHIVE_MAGIC = [0x4b, 0x43, 0x53, 0x41]; // "KCSA"

/** Wrong project name or password (or tampered data): authentication failed. */
export class DecryptError extends Error {
    constructor(message = "decryption failed", options) {
        super(message, options);
        this.name = "DecryptError";
    }
}

/** The bytes are not a data.bin / archive this code understands. */
export class FormatError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "FormatError";
    }
}

function subtle() {
    const s = globalThis.crypto?.subtle;
    if (!s) {
        throw new Error("Web Crypto API is not available");
    }
    return s;
}

/** True when the runtime has every API this module needs. */
export function isSupported() {
    return (
        typeof globalThis.crypto?.subtle?.deriveKey === "function" &&
        typeof globalThis.CompressionStream === "function" &&
        typeof globalThis.DecompressionStream === "function" &&
        typeof globalThis.TextEncoder === "function"
    );
}

/**
 * Normalise user input: trim surrounding whitespace and apply NFKC (so e.g.
 * full-width letters become ASCII). Case is preserved.
 */
export function normalizeInput(value) {
    return String(value).trim().normalize("NFKC").trim();
}

export function isValidProjectName(name) {
    return PROJECT_NAME_PATTERN.test(name);
}

// --- binary helpers ---------------------------------------------------------

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false);
    return b;
}

function concat(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function lengthPrefixed(bytes) {
    return concat([u32(bytes.length), bytes]);
}

/**
 * Unambiguous key-derivation input: a domain tag followed by the normalised
 * project name and password, each prefixed with its UTF-8 byte length.
 */
export function encodeCredentials(projectName, password) {
    const name = normalizeInput(projectName);
    const pass = normalizeInput(password);
    if (!name || !pass) {
        throw new Error("project name and password must not be empty");
    }
    return concat([
        lengthPrefixed(encoder.encode(KDF_DOMAIN)),
        lengthPrefixed(encoder.encode(name)),
        lengthPrefixed(encoder.encode(pass)),
    ]);
}

/**
 * File id of a project, computed from the credentials alone (slow PBKDF2 with
 * the fixed LOCATOR_SALT), so the browser can find share/data/<id>.bin
 * without any public name-to-file table.
 */
export async function deriveLocator(projectName, password) {
    const base = await subtle().importKey(
        "raw",
        encodeCredentials(projectName, password),
        "PBKDF2",
        false,
        ["deriveBits"],
    );
    const bits = await subtle().deriveBits(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: encoder.encode(LOCATOR_SALT),
            iterations: PBKDF2_ITERATIONS,
        },
        base,
        LOCATOR_BYTES * 8,
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveKey(projectName, password, salt) {
    const base = await subtle().importKey(
        "raw",
        encodeCredentials(projectName, password),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return subtle().deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

// --- archive ---------------------------------------------------------------------

/**
 * Archive paths are relative, "/"-separated and may not escape the root.
 */
export function isSafeArchivePath(path) {
    if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\\")) {
        return false;
    }
    return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function sortedEntries(files) {
    const entries = files instanceof Map ? [...files] : Object.entries(files);
    return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Serialise files (Map of relative path -> Uint8Array) in a fixed order:
 *   "KCSA" | u32 count | { u32 pathLen | path (UTF-8) | u32 dataLen | data }*
 * The output is deterministic, so its SHA-256 is used for change detection.
 */
export function encodeArchive(files) {
    const parts = [new Uint8Array(ARCHIVE_MAGIC)];
    const entries = sortedEntries(files);
    parts.push(u32(entries.length));
    for (const [path, data] of entries) {
        if (!isSafeArchivePath(path)) {
            throw new Error(`unsafe archive path: ${path}`);
        }
        parts.push(lengthPrefixed(encoder.encode(path)), lengthPrefixed(data));
    }
    return concat(parts);
}

export function decodeArchive(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const need = (n) => {
        if (offset + n > bytes.length) {
            throw new FormatError("archive is truncated");
        }
    };
    need(8);
    if (!ARCHIVE_MAGIC.every((b, i) => bytes[i] === b)) {
        throw new FormatError("archive magic mismatch");
    }
    offset = 4;
    const count = view.getUint32(offset);
    offset += 4;
    const files = new Map();
    for (let i = 0; i < count; i++) {
        need(4);
        const pathLen = view.getUint32(offset);
        offset += 4;
        need(pathLen);
        let path;
        try {
            path = strictDecoder.decode(bytes.subarray(offset, offset + pathLen));
        } catch (err) {
            throw new FormatError("archive path is not UTF-8", { cause: err });
        }
        offset += pathLen;
        need(4);
        const dataLen = view.getUint32(offset);
        offset += 4;
        need(dataLen);
        if (!isSafeArchivePath(path) || files.has(path)) {
            throw new FormatError(`invalid archive path: ${path}`);
        }
        files.set(path, bytes.slice(offset, offset + dataLen));
        offset += dataLen;
    }
    if (offset !== bytes.length) {
        throw new FormatError("trailing bytes after archive");
    }
    return files;
}

export async function sha256Hex(bytes) {
    const digest = new Uint8Array(await subtle().digest("SHA-256", bytes));
    return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gzip(bytes) {
    return pipeBytes(bytes, new CompressionStream("gzip"));
}

export function gunzip(bytes) {
    return pipeBytes(bytes, new DecompressionStream("gzip"));
}

// --- data.bin ------------------------------------------------------------------------

/** Encrypt a file map into data.bin bytes. Salt and nonce are always fresh. */
export async function encryptArchive({ projectName, password, files }) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const header = concat([new Uint8Array([FORMAT_VERSION]), salt, nonce]);
    const key = await deriveKey(projectName, password, salt);
    const plaintext = await gzip(encodeArchive(files));
    const ciphertext = new Uint8Array(
        await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: header }, key, plaintext),
    );
    return concat([header, ciphertext]);
}

/**
 * Decrypt data.bin bytes into a Map of relative path -> Uint8Array.
 * Throws DecryptError for a wrong name/password, FormatError for bad data.
 */
export async function decryptArchive({ projectName, password, data }) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < HEADER_LENGTH + 16) {
        throw new FormatError("data is too short");
    }
    if (bytes[0] !== FORMAT_VERSION) {
        throw new FormatError(`unsupported format version ${bytes[0]}`);
    }
    const header = bytes.subarray(0, HEADER_LENGTH);
    const salt = bytes.subarray(1, 1 + SALT_LENGTH);
    const nonce = bytes.subarray(1 + SALT_LENGTH, HEADER_LENGTH);
    const key = await deriveKey(projectName, password, salt);
    let plaintext;
    try {
        plaintext = new Uint8Array(
            await subtle().decrypt(
                { name: "AES-GCM", iv: nonce, additionalData: header },
                key,
                bytes.subarray(HEADER_LENGTH),
            ),
        );
    } catch (err) {
        throw new DecryptError("decryption failed", { cause: err });
    }
    let archive;
    try {
        archive = await gunzip(plaintext);
    } catch (err) {
        throw new FormatError("decompression failed", { cause: err });
    }
    return decodeArchive(archive);
}

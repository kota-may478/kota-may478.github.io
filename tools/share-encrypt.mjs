#!/usr/bin/env node
// Encrypt / update the shared KiCad projects.
//
//   local_share/manifest.json      project name -> { id, password, hash, source }
//   local_share/<project>/         plaintext (never committed)
//   share/index.html               the single viewer page (generated)
//   share/data/<id>.bin            encrypted archive; <id> is derived from the
//                                  project name and password (deriveLocator in
//                                  share/assets/crypto-format.js)
//
// Run `node tools/share-encrypt.mjs --help` for usage. This file must not
// contain project names, passwords or source paths; those live only in the
// git-ignored manifest.

import { randomInt } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSupportedNode } from "./node-version.mjs";

// Check the Node.js version before loading the browser-shared module: a static
// import would be parsed (and fail) on old Node before any check could run.
assertSupportedNode();
const {
    ID_PATTERN,
    PASSWORD_ALPHABET,
    PASSWORD_LENGTH,
    SYMBOLS,
    deriveLocator,
    encodeArchive,
    encryptArchive,
    isValidProjectName,
    normalizeInput,
    sha256Hex,
} = await import("../share/assets/crypto-format.js");

// ---------------------------------------------------------------------------
// File selection rules (used both for --sync and for building data.bin)

/** Files taken anywhere in the project tree (hierarchical sheets included). */
export const INCLUDE_EXTENSIONS = [".kicad_pro", ".kicad_sch", ".kicad_pcb"];
/** Taken only at the project root: README.md and its optional English version. */
export const README_NAMES = ["README.md", "README.en.md"];
/** Image types that may be referenced from README.md. */
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp"];
/** Directories that are never entered: VCS, backups, fabrication outputs. */
export const EXCLUDED_DIRS = [
    /^\./, // .git, .history, editor folders
    /-backups$/,
    /^gerbers?$/i,
    /^production$/i,
    /^fab(rication)?$/i,
    /^jlcpcb$/i,
    /^node_modules$/,
];
/** Files that are never taken, even with an included extension. */
export const EXCLUDED_FILES = [
    /^_autosave-/,
    /^~/,
    /~$/,
    /\.lck$/,
    /^fp-info-cache$/,
    /\.kicad_prl$/,
    /-bak$/, // *.kicad_pcb-bak, *.kicad_sch-bak
    /\.bak$/,
    /^\./,
];

const DATA_DIR = "data";
const RESERVED_SHARE_DIRS = ["assets", DATA_DIR];
const DATA_FILE_PATTERN = /^[0-9a-f]{32}\.bin$/;
// Directories of the previous layout (share/<random id>/index.html + data.bin).
const LEGACY_ID_DIR_PATTERN = /^[a-z0-9]{16,64}$/;
const WINDOWS_UNSAFE_NAME_CHARS = /[*?]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export const INDEX_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>Shared project</title>
<link rel="stylesheet" href="assets/viewer.css">
<link rel="icon" href="../fig/dolphin_circle.ico" type="image/x-icon">
</head>
<body>
<div id="app"></div>
<script type="module" src="assets/share-main.js"></script>
</body>
</html>
`;

const USAGE = `Usage: node tools/share-encrypt.mjs [options]

Encrypts local_share/<project>/ into share/data/<id>.bin for every project in
local_share/manifest.json, skipping projects whose content is unchanged.
All projects share one URL (share/). Viewers enter an ID (the project name,
i.e. the folder name under local_share/) and the password; the data file name
is derived from those two, so nothing else has to be shared.

Options:
  --only <name>                 Process only this project (repeatable).
  --force                       Re-encrypt even if the content is unchanged.
  --sync                        Copy KiCad files / README.md (+ referenced images)
                                from each project's registered source first.
  --yes                         Do not ask before copying in --sync (never deletes).
  --set-source <name> <path>    Register or change a project's source folder
                                (registers the project if it is new).
  --rotate-password <name>      Issue a new password and re-encrypt (the data file
                                name changes; the old file is offered for deletion).
  --show-password <name>        Print the URL, ID and password to give to viewers.
  --list                        List projects (ID, data file, last update);
                                passwords are not shown.
  -h, --help                    Show this help.

Names containing ! $ * etc. must be quoted in the shell, e.g. --only 'a!b'.`;

// ---------------------------------------------------------------------------
// Random values

/** Uniform random string over `alphabet` using crypto.randomInt. */
function randomString(alphabet, length) {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += alphabet[randomInt(alphabet.length)];
    }
    return out;
}

/**
 * 20 characters from A-Z a-z 0-9 and !#$%*+-=?@^_, containing at least one
 * character of each class (whole-password rejection keeps it uniform among
 * the qualifying passwords).
 */
export function generatePassword() {
    const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, new RegExp(`[${SYMBOLS.replace(/[\\\]^-]/g, "\\$&")}]`)];
    for (;;) {
        const candidate = randomString(PASSWORD_ALPHABET, PASSWORD_LENGTH);
        if (classes.every((re) => re.test(candidate))) {
            return candidate;
        }
    }
}

// ---------------------------------------------------------------------------
// Paths

export function expandUserPath(p) {
    if (p === "~") {
        return homedir();
    }
    if (p.startsWith("~/") || p.startsWith("~\\")) {
        return path.join(homedir(), p.slice(2));
    }
    return path.resolve(p);
}

function toArchivePath(relOsPath) {
    return relOsPath.split(path.sep).join("/");
}

function fromArchivePath(rel) {
    return rel.split("/").join(path.sep);
}

function hasExt(name, exts) {
    const lower = name.toLowerCase();
    return exts.some((ext) => lower.endsWith(ext));
}

function isExcludedFile(name) {
    return EXCLUDED_FILES.some((re) => re.test(name));
}

function isExcludedDir(name) {
    return EXCLUDED_DIRS.some((re) => re.test(name));
}

// ---------------------------------------------------------------------------
// File collection

/** Image references in README.md: inline, reference definitions and <img>. */
export function readmeImageRefs(markdown) {
    const refs = new Set();
    const patterns = [
        /!\[[^\]]*\]\(\s*<([^>]+)>/g,
        /!\[[^\]]*\]\(\s*([^)\s]+)/g,
        /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
        /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi,
    ];
    for (const re of patterns) {
        for (const m of markdown.matchAll(re)) {
            refs.add(m[1]);
        }
    }
    return [...refs];
}

/** Resolve a README reference to an archive path, or null if not local. */
function resolveReadmeRef(ref) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/") || ref.startsWith("#")) {
        return null;
    }
    const clean = ref.split(/[?#]/)[0];
    let decoded;
    try {
        decoded = decodeURIComponent(clean);
    } catch {
        return null;
    }
    const normalized = path.posix.normalize(decoded);
    if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
        return null;
    }
    return normalized.replace(/^\.\//, "");
}

/**
 * Select the shareable files of a project directory:
 * *.kicad_pro / *.kicad_sch / *.kicad_pcb anywhere (except excluded dirs and
 * files), README.md at the root, and existing images referenced by README.md.
 * Returns a sorted array of archive paths ("/"-separated).
 */
export function selectProjectFiles(rootDir) {
    const selected = new Set();
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) {
                continue; // never follow links out of the project
            }
            if (entry.isDirectory()) {
                if (!isExcludedDir(entry.name)) {
                    walk(full);
                }
            } else if (entry.isFile() && !isExcludedFile(entry.name) && hasExt(entry.name, INCLUDE_EXTENSIONS)) {
                selected.add(toArchivePath(path.relative(rootDir, full)));
            }
        }
    };
    walk(rootDir);

    for (const readmeName of README_NAMES) {
        const readmePath = path.join(rootDir, readmeName);
        if (!isRegularFileInside(rootDir, readmePath)) {
            continue;
        }
        selected.add(readmeName);
        for (const ref of readmeImageRefs(readFileSync(readmePath, "utf8"))) {
            const rel = resolveReadmeRef(ref);
            if (!rel || !hasExt(rel, IMAGE_EXTENSIONS)) {
                continue;
            }
            const segments = rel.split("/");
            if (segments.slice(0, -1).some(isExcludedDir) || isExcludedFile(segments.at(-1))) {
                continue;
            }
            const full = path.join(rootDir, fromArchivePath(rel));
            if (isRegularFileInside(rootDir, full)) {
                selected.add(rel);
            }
        }
    }
    return [...selected].sort();
}

/**
 * True if `full` is a regular file whose real path (all symlinks resolved,
 * including those in parent directories) lies inside `rootDir`.
 */
function isRegularFileInside(rootDir, full) {
    if (!existsSync(full) || lstatSync(full).isSymbolicLink()) {
        return false;
    }
    let realRoot;
    let realFile;
    try {
        realRoot = realpathSync(rootDir);
        realFile = realpathSync(full);
    } catch {
        return false;
    }
    return realFile.startsWith(realRoot + path.sep) && lstatSync(realFile).isFile();
}

export function readProjectFiles(rootDir) {
    const files = new Map();
    for (const rel of selectProjectFiles(rootDir)) {
        files.set(rel, new Uint8Array(readFileSync(path.join(rootDir, fromArchivePath(rel)))));
    }
    return files;
}

// ---------------------------------------------------------------------------
// Manifest

export function loadManifest(file) {
    if (!existsSync(file)) {
        return { version: 1, projects: {} };
    }
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data !== "object" || data === null || typeof data.projects !== "object") {
        throw new Error(`${file}: unexpected manifest structure`);
    }
    return data;
}

function writeFileAtomic(file, content, mode) {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, content, mode === undefined ? undefined : { mode });
    renameSync(tmp, file);
}

export function saveManifest(file, manifest) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(manifest, null, 2) + "\n", 0o600);
}

// ---------------------------------------------------------------------------
// CLI parsing

export function parseArgs(argv) {
    const opts = {
        only: [],
        force: false,
        sync: false,
        yes: false,
        setSource: [],
        rotate: [],
        show: [],
        list: false,
        help: false,
    };
    const take = (i, flag) => {
        if (i >= argv.length || argv[i].startsWith("--")) {
            throw new Error(`${flag} needs a value`);
        }
        return argv[i];
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--only":
                opts.only.push(normalizeInput(take(++i, a)));
                break;
            case "--force":
                opts.force = true;
                break;
            case "--sync":
                opts.sync = true;
                break;
            case "--yes":
            case "-y":
                opts.yes = true;
                break;
            case "--set-source": {
                const name = normalizeInput(take(++i, a));
                opts.setSource.push([name, take(++i, a)]);
                break;
            }
            case "--rotate-password":
                opts.rotate.push(normalizeInput(take(++i, a)));
                break;
            case "--list":
                opts.list = true;
                break;
            case "--show-password":
                opts.show.push(normalizeInput(take(++i, a)));
                break;
            case "-h":
            case "--help":
                opts.help = true;
                break;
            default:
                throw new Error(`unknown option: ${a}`);
        }
    }
    return opts;
}

// ---------------------------------------------------------------------------
// Main

function defaultIo() {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    return {
        interactive,
        log: (...a) => console.log(...a),
        warn: (...a) => console.warn(...a),
        async confirm(question) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            try {
                const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
                return answer === "y" || answer === "yes";
            } finally {
                rl.close();
            }
        },
    };
}

/**
 * Run the tool. `io` = { interactive, log, warn, confirm(question) } can be
 * injected for tests; `rootDir` is the repository root.
 * Returns a summary object (used by tests).
 */
export async function run(argv, { rootDir = defaultRootDir(), io = defaultIo() } = {}) {
    const opts = parseArgs(argv);
    if (opts.help) {
        io.log(USAGE);
        return { help: true };
    }

    const localDir = path.join(rootDir, "local_share");
    const shareDir = path.join(rootDir, "share");
    const manifestFile = path.join(localDir, "manifest.json");
    const manifest = loadManifest(manifestFile);
    const projects = manifest.projects;
    const summary = { results: {}, registered: [], staleDeleted: [], staleKept: [], syncWarnings: {} };
    const forced = new Set();

    checkGitignore(rootDir, io);
    const url = shareUrl(rootDir);

    const register = async (name) => {
        const password = generatePassword();
        const id = await deriveLocator(name, password);
        projects[name] = { id, password, hash: null };
        saveManifest(manifestFile, manifest);
        summary.registered.push(name);
        io.log(`\n[new] ${name}`);
        printShareInfo(io, url, name, projects[name]);
        io.log(`  (shown only now; use --show-password ${shellQuote(name)} to see it again)`);
    };
    const requireValidName = (name) => {
        if (!isValidProjectName(name)) {
            throw new Error(
                `invalid project name ${JSON.stringify(name)}: use 1-64 characters from A-Z a-z 0-9 ${SYMBOLS}`,
            );
        }
        if (WINDOWS_UNSAFE_NAME_CHARS.test(name)) {
            io.warn(`warning: ${JSON.stringify(name)} contains * or ?, which cannot be used in folder names on Windows`);
        }
        if (WINDOWS_RESERVED_NAMES.test(name)) {
            io.warn(`warning: ${JSON.stringify(name)} is a reserved device name and cannot be used as a folder name on Windows`);
        }
    };

    // --set-source
    for (const [name, source] of opts.setSource) {
        requireValidName(name);
        if (!projects[name]) {
            await register(name);
        }
        projects[name].source = source;
        saveManifest(manifestFile, manifest);
        io.log(`source of ${name}: ${source} (-> ${expandUserPath(source)})`);
    }

    // --rotate-password
    for (const name of opts.rotate) {
        if (!projects[name]) {
            throw new Error(`--rotate-password: unknown project ${JSON.stringify(name)}`);
        }
        projects[name].password = generatePassword();
        saveManifest(manifestFile, manifest);
        forced.add(name);
    }

    // The file id must always equal deriveLocator(name, password). This also
    // migrates entries from the old layout (random ids) and follows password
    // rotations; a changed id means the project is encrypted again as new.
    for (const name of Object.keys(projects).sort()) {
        const project = projects[name];
        const expected = await deriveLocator(name, project.password);
        if (project.id !== expected) {
            if (!opts.rotate.includes(name)) {
                io.log(`[data file] ${name}: ${project.id ?? "(none)"} -> ${expected}`);
            }
            project.id = expected;
            project.hash = null;
            saveManifest(manifestFile, manifest);
        }
    }

    for (const name of opts.rotate) {
        io.log(`\n[new password] ${name}`);
        printShareInfo(io, url, name, projects[name]);
        io.log("  (URL and ID unchanged; the old data file will be offered for deletion)");
    }

    // --show-password
    for (const name of opts.show) {
        if (!projects[name]) {
            throw new Error(`--show-password: unknown project ${JSON.stringify(name)}`);
        }
        io.log(`${name}`);
        printShareInfo(io, url, name, projects[name]);
    }

    // --list
    if (opts.list) {
        summary.list = listProjects(projects);
        io.log(`share URL (all projects): ${url}`);
        io.log("ID (give to viewers) / data file (internal) / last update:");
        for (const line of formatList(summary.list)) {
            io.log(line);
        }
    }

    // --set-source / --show-password / --list on their own only manage the manifest.
    const manageOnly =
        (opts.setSource.length || opts.show.length || opts.list) &&
        !opts.sync &&
        !opts.force &&
        !opts.only.length &&
        !opts.rotate.length;
    if (manageOnly) {
        return summary;
    }

    // Unregistered folders in local_share/
    const localNames = existsSync(localDir)
        ? readdirSync(localDir, { withFileTypes: true })
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => e.name)
        : [];
    const candidates = opts.only.length ? localNames.filter((n) => opts.only.includes(n)) : localNames;
    for (const name of candidates.filter((n) => !projects[n])) {
        if (!isValidProjectName(name)) {
            io.warn(`warning: local_share/${name}/ is not a valid project name (A-Z a-z 0-9 ${SYMBOLS}); skipped`);
            continue;
        }
        if (!io.interactive) {
            io.warn(`warning: local_share/${name}/ is not registered in the manifest (run interactively to register)`);
            continue;
        }
        if (await io.confirm(`local_share/${name}/ is not registered. Register it as a new project?`)) {
            requireValidName(name);
            await register(name);
        }
    }

    // Targets
    let targets = Object.keys(projects).sort();
    if (opts.only.length) {
        for (const name of opts.only) {
            if (!projects[name]) {
                io.warn(`warning: --only ${name}: not registered; skipped`);
            }
        }
        targets = targets.filter((n) => opts.only.includes(n));
    }

    // --sync
    if (opts.sync) {
        for (const name of targets) {
            await syncProject(name, projects[name], localDir, opts, io, summary);
        }
    }

    // Encrypt
    mkdirSync(path.join(shareDir, DATA_DIR), { recursive: true });
    const indexFile = path.join(shareDir, "index.html");
    if (!existsSync(indexFile) || readFileSync(indexFile, "utf8") !== INDEX_HTML) {
        writeFileAtomic(indexFile, INDEX_HTML);
        io.log("wrote share/index.html");
    }
    io.log("");
    for (const name of targets) {
        summary.results[name] = await encryptProject(name, projects[name], {
            localDir,
            shareDir,
            force: opts.force || forced.has(name),
            io,
        });
        saveManifest(manifestFile, manifest);
    }

    // Stale files
    await handleStaleFiles(shareDir, projects, io, summary);

    io.log("\nNext: review and stage only the encrypted output, e.g.");
    io.log("  git status --short share/");
    io.log("  git add share/");
    io.log("(local_share/ - plaintext, passwords, manifest - is git-ignored and must not be committed.)");
    return summary;
}

/**
 * Public URL of the viewer (common to all projects), built from the
 * repository's CNAME (custom domain). Without a CNAME the site-relative path
 * is returned.
 */
export function shareUrl(rootDir) {
    const cnameFile = path.join(rootDir, "CNAME");
    const host = existsSync(cnameFile) ? readFileSync(cnameFile, "utf8").trim().split(/\s+/)[0] : "";
    return host ? `https://${host}/share/` : "/share/";
}

/** Rows for --list; never includes passwords. */
export function listProjects(projects) {
    return Object.keys(projects)
        .sort()
        .map((name) => ({
            name,
            id: projects[name].id,
            updatedAt: projects[name].hash ? projects[name].updatedAt ?? null : null,
            source: projects[name].source ?? null,
        }));
}

function formatLocalTime(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatList(rows) {
    if (!rows.length) {
        return ["(no projects registered)"];
    }
    const width = Math.max(...rows.map((r) => r.name.length));
    return rows.flatMap((r) => [
        `${r.name.padEnd(width)}  share/data/${r.id}.bin  ${r.updatedAt ? `updated ${formatLocalTime(r.updatedAt)}` : "(not encrypted yet)"}`,
        ...(r.source ? [`${" ".repeat(width)}  source: ${r.source}`] : []),
    ]);
}

/** What to give to viewers (URL, ID, password) plus the internal data file. */
function printShareInfo(io, url, name, project) {
    io.log(`  url:       ${url}`);
    io.log(`  id:        ${name}`);
    io.log(`  password:  ${project.password}`);
    io.log(`  data file: share/data/${project.id}.bin (internal; not shared)`);
}

function shellQuote(s) {
    return /^[A-Za-z0-9_=+-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

function checkGitignore(rootDir, io) {
    const file = path.join(rootDir, ".gitignore");
    const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()) : [];
    if (!lines.some((l) => l === "local_share/" || l === "local_share" || l === "/local_share/")) {
        io.warn("warning: .gitignore does not list local_share/ - plaintext could be committed!");
    }
}

async function encryptProject(name, project, { localDir, shareDir, force, io }) {
    const projectDir = path.join(localDir, name);
    if (!existsSync(projectDir)) {
        io.warn(`[missing] ${name}: local_share/${name}/ does not exist; skipped`);
        return "missing";
    }
    if (!ID_PATTERN.test(project.id ?? "")) {
        throw new Error(`manifest: project ${JSON.stringify(name)} has an invalid id`);
    }
    const files = readProjectFiles(projectDir);
    if (![...files.keys()].some((p) => hasExt(p, INCLUDE_EXTENSIONS))) {
        io.warn(`warning: ${name}: no KiCad files found`);
    }
    const hash = await sha256Hex(encodeArchive(files));
    const relFile = `share/${DATA_DIR}/${project.id}.bin`;
    const dataFile = path.join(shareDir, DATA_DIR, `${project.id}.bin`);

    const isNew = !project.hash || !existsSync(dataFile);
    const status = isNew ? "new" : project.hash !== hash ? "updated" : force ? "forced" : "unchanged";
    const label = { new: "新規", updated: "更新", forced: "強制再暗号化", unchanged: "変更なし（スキップ）" }[status];
    if (status === "unchanged") {
        io.log(`[${label}] ${name} -> ${relFile}`);
        return status;
    }
    const data = await encryptArchive({ projectName: name, password: project.password, files });
    writeFileAtomic(dataFile, data);
    project.hash = hash;
    project.updatedAt = new Date().toISOString();
    io.log(`[${label}] ${name} -> ${relFile} (${files.size} files, ${data.length} bytes)`);
    return status;
}

async function syncProject(name, project, localDir, opts, io, summary) {
    if (!project.source) {
        if (opts.only.includes(name)) {
            io.warn(`warning: ${name}: no source registered (use --set-source); sync skipped`);
        }
        return;
    }
    const sourceDir = expandUserPath(project.source);
    if (!existsSync(sourceDir) || !lstatSync(sourceDir).isDirectory()) {
        io.warn(`warning: ${name}: source ${sourceDir} is not a directory; sync skipped`);
        return;
    }
    const destDir = path.join(localDir, name);
    const sourceFiles = selectProjectFiles(sourceDir);
    const plan = { add: [], overwrite: [], same: [] };
    for (const rel of sourceFiles) {
        const src = path.join(sourceDir, fromArchivePath(rel));
        const dst = path.join(destDir, fromArchivePath(rel));
        if (!existsSync(dst)) {
            plan.add.push(rel);
        } else if (Buffer.compare(readFileSync(src), readFileSync(dst)) !== 0) {
            plan.overwrite.push(rel);
        } else {
            plan.same.push(rel);
        }
    }
    const destOnly = existsSync(destDir)
        ? selectProjectFiles(destDir).filter((rel) => !sourceFiles.includes(rel))
        : [];

    io.log(`\n[sync] ${name}: ${sourceDir} -> local_share/${name}/`);
    for (const rel of plan.add) io.log(`  add        ${rel}`);
    for (const rel of plan.overwrite) io.log(`  overwrite  ${rel}`);
    for (const rel of plan.same) io.log(`  unchanged  ${rel}`);
    if (destOnly.length) {
        summary.syncWarnings[name] = destOnly;
        io.warn(`  warning: not in source any more (kept, not deleted):`);
        for (const rel of destOnly) io.warn(`    ${rel}`);
    }

    if (!plan.add.length && !plan.overwrite.length) {
        io.log("  nothing to copy");
        return;
    }
    let proceed = opts.yes;
    if (!proceed) {
        if (!io.interactive) {
            io.warn("  warning: not copied (non-interactive; pass --yes to copy)");
            return;
        }
        proceed = await io.confirm(`  Copy ${plan.add.length} new and ${plan.overwrite.length} changed file(s)?`);
    }
    if (!proceed) {
        io.log("  skipped");
        return;
    }
    for (const rel of [...plan.add, ...plan.overwrite]) {
        const dst = path.join(destDir, fromArchivePath(rel));
        mkdirSync(path.dirname(dst), { recursive: true });
        copyFileSync(path.join(sourceDir, fromArchivePath(rel)), dst);
    }
    io.log(`  copied ${plan.add.length + plan.overwrite.length} file(s)`);
}

/**
 * Offer to delete encrypted files that no manifest entry points to any more
 * (renamed/removed projects, rotated passwords) and directories of the old
 * share/<id>/ layout. Nothing is deleted without an interactive "y".
 */
async function handleStaleFiles(shareDir, projects, io, summary) {
    if (!existsSync(shareDir)) {
        return;
    }
    const known = new Set(Object.values(projects).map((p) => `${p.id}.bin`));
    const deletable = [];
    const other = [];
    const dataDir = path.join(shareDir, DATA_DIR);
    if (existsSync(dataDir)) {
        for (const e of readdirSync(dataDir, { withFileTypes: true })) {
            if (known.has(e.name)) {
                continue;
            }
            const rel = `${DATA_DIR}/${e.name}`;
            (e.isFile() && DATA_FILE_PATTERN.test(e.name) ? deletable : other).push(rel);
        }
    }
    for (const e of readdirSync(shareDir, { withFileTypes: true })) {
        if (RESERVED_SHARE_DIRS.includes(e.name) || e.name === "index.html") {
            continue;
        }
        if (e.isDirectory() && LEGACY_ID_DIR_PATTERN.test(e.name)) {
            deletable.push(`${e.name}/`);
        } else {
            other.push(e.isDirectory() ? `${e.name}/` : e.name);
        }
    }
    deletable.sort();
    other.sort();
    if (!deletable.length && !other.length) {
        return;
    }
    io.warn("\nshare/ contains entries that are not used by any project in the manifest:");
    for (const rel of deletable) io.warn(`  share/${rel}`);
    for (const rel of other) io.warn(`  share/${rel}  (unexpected; never deleted by this tool)`);
    summary.staleKept.push(...other);
    if (!deletable.length) {
        return;
    }
    if (!io.interactive) {
        io.warn("warning: not deleted (non-interactive)");
        summary.staleKept.push(...deletable);
        return;
    }
    if (await io.confirm(`Delete ${deletable.length} unused entr${deletable.length === 1 ? "y" : "ies"} listed above?`)) {
        for (const rel of deletable) {
            rmSync(path.join(shareDir, rel), { recursive: true, force: true });
            summary.staleDeleted.push(rel);
            io.log(`  deleted share/${rel}`);
        }
    } else {
        summary.staleKept.push(...deletable);
        io.log("  kept");
    }
}

function defaultRootDir() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    run(process.argv.slice(2)).catch((err) => {
        console.error(`error: ${err.message}`);
        process.exitCode = 1;
    });
}

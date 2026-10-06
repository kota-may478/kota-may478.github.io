// Node.js version guard for the tools in this directory.
//
// The tools import share/assets/crypto-format.js, a browser-shared ES module
// with a plain ".js" extension and no package.json "type" field. Node only
// treats such a file as an ES module through its syntax detection, which is
// on by default from 22.7.0 (and 20.19.0 on the 20.x line); older versions
// fail with an unhelpful SyntaxError. The tools also rely on the global Web
// Crypto API and CompressionStream.
//
// Keep this file free of newer syntax and of imports, so that it still runs
// (and prints a clear message) on old Node versions.

export const REQUIRED_NODE = "22.7.0 or later (or 20.19.0+ on the 20.x line)";

/** True if `version` (e.g. "v22.23.2") can run the tools. */
export function isSupportedNodeVersion(version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version));
    if (!match) {
        return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major >= 23) {
        return true;
    }
    if (major === 22) {
        return minor >= 7;
    }
    if (major === 20) {
        return minor >= 19;
    }
    return false;
}

/** Missing runtime features, if any (names only). */
export function missingFeatures(scope) {
    const missing = [];
    if (!(scope.crypto && scope.crypto.subtle && typeof scope.crypto.getRandomValues === "function")) {
        missing.push("globalThis.crypto (Web Crypto API)");
    }
    if (typeof scope.CompressionStream !== "function" || typeof scope.DecompressionStream !== "function") {
        missing.push("CompressionStream / DecompressionStream");
    }
    return missing;
}

/**
 * Exit with a clear message when the running Node.js cannot run the tools.
 * Must be called before share/assets/crypto-format.js is imported.
 */
export function assertSupportedNode() {
    const version = process.version;
    const problems = [];
    if (!isSupportedNodeVersion(version)) {
        problems.push("Node.js " + REQUIRED_NODE + " is required (running " + version + ").");
    }
    const missing = missingFeatures(globalThis);
    if (missing.length) {
        problems.push("Missing runtime features: " + missing.join(", ") + ".");
    }
    if (problems.length) {
        console.error("error: " + problems.join("\n       "));
        console.error("       Please update Node.js (https://nodejs.org/) and run the command again.");
        process.exit(1);
    }
}

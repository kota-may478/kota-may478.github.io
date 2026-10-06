// Production data source for share/index.html.
//
// From the entered project name and password it derives the file id (slow
// PBKDF2 with a fixed public salt), fetches share/data/<id>.bin, decrypts it
// in memory with a key derived from the same credentials and the file's own
// random salt, and hands the files to the shared presentation layer.
// Nothing is persisted.

import {
    DecryptError,
    FormatError,
    decryptArchive,
    deriveLocator,
    isSupported,
    normalizeInput,
} from "./crypto-format.js";
import { SourceError, startViewer } from "./viewer.js";

async function fetchProjectFile(fileId) {
    let response;
    try {
        response = await fetch(`data/${fileId}.bin`, { cache: "no-cache" });
    } catch (err) {
        throw new SourceError("network", { cause: err });
    }
    if (response.status === 404) {
        // No file for these credentials: the name or password is wrong.
        throw new SourceError("credentials");
    }
    if (!response.ok) {
        throw new SourceError("network", { cause: new Error(`HTTP ${response.status}`) });
    }
    return new Uint8Array(await response.arrayBuffer());
}

const encryptedSource = {
    requiresCredentials: true,
    async open({ projectName, password }) {
        if (!isSupported()) {
            throw new SourceError("unsupported");
        }
        const fileId = await deriveLocator(projectName, password);
        const data = await fetchProjectFile(fileId);
        try {
            const files = await decryptArchive({ projectName, password, data });
            return { projectName: normalizeInput(projectName), files };
        } catch (err) {
            if (err instanceof DecryptError) {
                throw new SourceError("credentials", { cause: err });
            }
            if (err instanceof FormatError) {
                throw new SourceError("format", { cause: err });
            }
            throw err;
        }
    },
};

startViewer({ root: document.getElementById("app"), source: encryptedSource });

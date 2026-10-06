// Production data source: fetches ./data.bin next to share/<id>/index.html,
// decrypts it in memory with the entered project name and password, and
// hands the files to the shared presentation layer. Nothing is persisted.

import {
    DecryptError,
    FormatError,
    decryptArchive,
    isSupported,
    normalizeInput,
} from "./crypto-format.js";
import { SourceError, startViewer } from "./viewer.js";

let dataPromise = null;

// data.bin is fetched once per page load and reused for every attempt.
function loadData() {
    dataPromise ??= fetch("data.bin", { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    });
    return dataPromise.catch((err) => {
        dataPromise = null; // allow a retry after a network failure
        throw new SourceError("network", { cause: err });
    });
}

const encryptedSource = {
    requiresCredentials: true,
    async open({ projectName, password }) {
        if (!isSupported()) {
            throw new SourceError("unsupported");
        }
        const data = await loadData();
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

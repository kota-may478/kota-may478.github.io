#!/usr/bin/env bash
# Build the CV with XeLaTeX and publish pdf/AcademicCV.pdf only after success.
set -euo pipefail

TEX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${TEX_DIR}/../../.." && pwd)"
DEST="${REPO_ROOT}/pdf/AcademicCV.pdf"
BUILD_DIR="${TEX_DIR}/build"
SRC="${BUILD_DIR}/cv.pdf"
TMP="${DEST}.tmp"

echo "XeLaTeX build directory: ${BUILD_DIR}"
echo "Published PDF (written only after a successful build): ${DEST}"

if ! bash "${TEX_DIR}/install-fonts.sh"; then
  echo "Font check failed. ${DEST} was not modified." >&2
  exit 1
fi

mkdir -p "${BUILD_DIR}"
cd "${TEX_DIR}"
if ! latexmk cv.tex; then
  echo "latexmk failed. ${DEST} was not modified." >&2
  exit 1
fi
if [[ ! -s "${SRC}" ]]; then
  echo "PDF was not produced at ${SRC}. ${DEST} was not modified." >&2
  exit 1
fi

cp "${SRC}" "${TMP}"
mv -f "${TMP}" "${DEST}"
echo "Updated ${DEST}"

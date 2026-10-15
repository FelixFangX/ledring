export interface ArtifactFile {
  path: string;
  contents: string;
}

export interface FilePlan {
  entry: "index.html";
  files: readonly ArtifactFile[];
}

/** One multi-file preset. The visible word is written by app.js, so a judge that only sees index.html stays blank. */
export const MULTI_FILE_PRESET: FilePlan = {
  entry: "index.html",
  files: [
    {
      path: "index.html",
      contents:
        "<!doctype html><html><head><meta charset=\"utf-8\"><link rel=\"stylesheet\" href=\"app.css\"></head><body><p id=\"out\"></p><script src=\"app.js\"></script></body></html>",
    },
    {
      path: "app.js",
      contents: 'document.getElementById("out").textContent = "ready";\n',
    },
    {
      path: "app.css",
      contents: "body{margin:0}\n",
    },
  ],
};

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/;

/** Accept a flat file list. Reject traversal, duplicates, remote paths, and a plan with no index.html. */
export function normalizeFilePlan(files: readonly { path: string; contents: string }[]): { ok: true; plan: FilePlan } | { ok: false; error: string } {
  if (files.length < 1 || files.length > 8) return { ok: false, error: "invalid file plan" };
  const seen = new Set<string>();
  const normalized: ArtifactFile[] = [];
  for (const file of files) {
    if (typeof file.path !== "string" || typeof file.contents !== "string") return { ok: false, error: "invalid file plan" };
    if (!FILE_NAME.test(file.path)) return { ok: false, error: "invalid file plan" };
    if (file.contents.length > 200_000) return { ok: false, error: "invalid file plan" };
    if (seen.has(file.path)) return { ok: false, error: "invalid file plan" };
    seen.add(file.path);
    normalized.push({ path: file.path, contents: file.contents });
  }
  if (!seen.has("index.html")) return { ok: false, error: "invalid file plan" };
  return { ok: true, plan: { entry: "index.html", files: normalized } };
}

export function previewContentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/** Same-origin scripts and styles for a multi-file preview. Single-file iframes keep ARTIFACT_CSP instead. */
export const PREVIEW_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src data: blob:";

/**
 * Headers a WebContainer page must send. COEP require-corp means every subresource needs CORP or CORS.
 * The bridge preview sends these too so the same files can be judged from a cross-origin-isolated document.
 */
export const WEBCONTAINER_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
} as const;

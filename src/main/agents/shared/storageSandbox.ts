import path from 'node:path';

// Shared sandbox helpers used by file tools. The base path is set once at app
// startup (from main/index.ts) so tools can resolve absolute paths without
// holding a StorageService reference.

let basePathResolver: (() => string) | null = null;

export function setStorageBasePathResolver(fn: () => string): void {
  basePathResolver = fn;
}

export function resolvePaperRoot(arxivId: string): string {
  if (!basePathResolver) {
    throw new Error('Storage base path resolver not configured. Call setStorageBasePathResolver from main.');
  }
  return path.join(basePathResolver(), arxivId);
}

// Clamp `relPath` to `root`. Reject absolute paths and any segments that would
// escape via `..`. Returns the absolute path inside the sandbox.
export function safeJoin(root: string, relPath: string): string {
  const normalized = relPath === '.' || relPath === '' ? '' : relPath;
  if (path.isAbsolute(normalized)) {
    throw new Error(`Path must be relative to the paper directory: ${relPath}`);
  }
  const joined = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (joined !== rootResolved && !joined.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path escapes the paper directory: ${relPath}`);
  }
  return joined;
}

import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function codeOf(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

async function realpathNearestExisting(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (codeOf(error) !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function assertPathInsideProject(path: string, cwd: string): Promise<void> {
  const root = resolve(cwd);
  const realRoot = await realpath(root);
  const target = resolve(path);

  if (!isInside(root, target) && !isInside(realRoot, target)) {
    throw new Error(`Path is outside project root: ${path}`);
  }

  const realTargetOrParent = await realpathNearestExisting(target);
  if (!isInside(realRoot, realTargetOrParent)) {
    throw new Error(`Path resolves outside project root: ${path}`);
  }
}

export async function assertToolPathsInsideProject(args: unknown, cwd: string): Promise<void> {
  if (!isRecord(args)) return;

  for (const key of ["path", "file_path"]) {
    const path = args[key];
    if (typeof path === "string") {
      await assertPathInsideProject(path, cwd);
    }
  }
}

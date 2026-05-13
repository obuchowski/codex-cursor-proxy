import { resolve } from "node:path";

export type CliOptions = {
  debug: boolean;
  projectCwd: string;
};

export function parseCli(): CliOptions {
  const argv = process.argv;
  const debug = argv.includes("--debug");

  let projectDir: string | undefined;
  if (argv[1] === "run") {
    const scriptIndex = argv.findIndex((arg) => arg.endsWith(".ts"));
    const next = scriptIndex >= 0 ? argv[scriptIndex + 1] : undefined;
    if (next && !next.startsWith("-")) {
      projectDir = next;
    }
  } else {
    const candidate = argv[2];
    if (candidate && !candidate.startsWith("-")) {
      projectDir = candidate;
    }
  }

  return { debug, projectCwd: projectDir ? resolve(projectDir) : process.cwd() };
}

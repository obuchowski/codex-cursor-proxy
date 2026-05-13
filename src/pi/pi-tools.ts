import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";

export type PiToolEntry = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  agent: AgentTool;
};

type PiToolSpec = {
  name: string;
  label: string;
  create: (cwd: string) => AgentTool;
  /** Only whitelisted tools are injected into Codex and executed by the proxy. */
  enabled: boolean;
};

export const PI_TOOL_REGISTRY: PiToolSpec[] = [
  { name: "ReadFile",  label: "Read File",  create: createReadTool,  enabled: false },
  { name: "fileEdit",  label: "File Edit",  create: createEditTool,  enabled: true  },
  { name: "fileWrite", label: "File Write", create: createWriteTool, enabled: true  },
  { name: "Shell",     label: "Shell",      create: createBashTool,  enabled: false },
];

export function isPiToolName(name: string): boolean {
  return PI_TOOL_REGISTRY.some((s) => s.enabled && s.name === name);
}

export function getPiToolLabel(name: string): string {
  return PI_TOOL_REGISTRY.find((s) => s.name === name)?.label ?? name;
}

function wrap(spec: PiToolSpec, cwd: string): PiToolEntry {
  const agent = spec.create(cwd);
  return { name: spec.name, label: spec.label, description: `[proxy / pi] ${agent.description}`, parameters: agent.parameters, agent };
}

export function buildPiTools(cwd: string): PiToolEntry[] {
  return PI_TOOL_REGISTRY.filter((s) => s.enabled).map((s) => wrap(s, cwd));
}

export function piToolsAsCodexDefs(entries: PiToolEntry[]): Record<string, unknown>[] {
  return entries.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function executePiTool(
  entry: PiToolEntry,
  callId: string,
  rawArgs: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const params = entry.agent.prepareArguments ? entry.agent.prepareArguments(rawArgs) : (rawArgs as never);
  const run = entry.agent.execute(callId, params, signal);
  const result = await Promise.race([
    run,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`pi tool timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
  const parts = result.content
    .map((c) => (c.type === "text" ? c.text : c.type === "image" ? `[image ${c.mimeType}]` : ""))
    .filter(Boolean);
  return parts.join("\n") || "(empty)";
}

export function findPiTool(entries: PiToolEntry[], name: string): PiToolEntry | undefined {
  return entries.find((e) => e.name === name);
}

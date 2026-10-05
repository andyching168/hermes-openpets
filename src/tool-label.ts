/** Fixed, sanitized tool categories. Raw tool names/args never leave this file. */
export const TOOL_LABELS = ["Running terminal…", "Searching…", "Using browser…", "Running Python…", "Editing files…", "Working…"] as const;
export type ToolLabel = (typeof TOOL_LABELS)[number];

export function toolLabel(toolName?: string): ToolLabel {
  const n = (toolName ?? "").toLowerCase();
  if (/terminal|shell|bash|exec|command/.test(n)) return "Running terminal…";
  if (/browser|navigate|click|screenshot/.test(n)) return "Using browser…";
  if (/search|web|fetch|grep|find/.test(n)) return "Searching…";
  if (/python|code_exec|jupyter|notebook/.test(n)) return "Running Python…";
  if (/file|read|write|edit|patch|diff/.test(n)) return "Editing files…";
  return "Working…";
}

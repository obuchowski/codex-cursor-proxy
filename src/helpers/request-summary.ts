export function previewJson(value: unknown, max = 280): string {
  try {
    const text = JSON.stringify(value) ?? String(value);
    return text.length <= max ? text : `${text.slice(0, max)}...`;
  } catch {
    return "[unserializable]";
  }
}

export function inputItemCount(body: Record<string, unknown>): number {
  return Array.isArray(body.input) ? body.input.length : 0;
}

export function inputTailSummary(body: Record<string, unknown>, tailCount = 6): string {
  const input = Array.isArray(body.input) ? body.input : [];
  return input
    .slice(-tailCount)
    .map((item, idx) => {
      if (!item || typeof item !== "object") return `${idx}:${typeof item}`;

      const obj = item as Record<string, unknown>;
      const bits = [
        obj.role && `role=${obj.role}`,
        obj.type && `type=${obj.type}`,
        obj.name && `name=${obj.name}`,
        obj.id && `id=${obj.id}`,
        obj.call_id && `call_id=${obj.call_id}`,
      ].filter(Boolean);

      const payload = obj.output ?? obj.arguments ?? obj.content;
      return `${idx}:${bits.join(" ")} payload=${previewJson(payload, 500)}`;
    })
    .join(" | ");
}

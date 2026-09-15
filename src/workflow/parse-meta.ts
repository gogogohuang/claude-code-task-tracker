export interface WorkflowMeta {
  name?: string;
  phases: string[];
}

export function parseWorkflowMeta(source: string): WorkflowMeta | undefined {
  const metaStart = source.search(/export\s+const\s+meta\s*=/);
  if (metaStart < 0) return undefined;
  const braceAt = source.indexOf("{", metaStart);
  const obj = extractBalanced(source, braceAt, "{", "}");
  if (!obj) return undefined;

  const name = matchQuotedField(obj, "name");
  const phasesKey = obj.search(/phases\s*:/);
  if (phasesKey < 0) return undefined;
  const arrAt = obj.indexOf("[", phasesKey);
  const arr = extractBalanced(obj, arrAt, "[", "]");
  if (!arr) return undefined;

  const phases: string[] = [];
  const re = /title\s*:\s*(['"])(.*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(arr))) phases.push(match[2]);
  if (phases.length === 0) return undefined;
  return { name, phases };
}

function matchQuotedField(source: string, field: string): string | undefined {
  const re = new RegExp(`${field}\\s*:\\s*(['"])(.*?)\\1`);
  return re.exec(source)?.[2];
}

function extractBalanced(source: string, start: number, open: string, close: string): string | undefined {
  if (start < 0 || source[start] !== open) return undefined;
  let depth = 0;
  let quote: string | undefined;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return undefined;
}

// AUTO-GENERATED FILE - DO NOT EDIT
// Generated from distill.md by scripts/generate-prompts.ts
// To modify, edit distill.md and run `npm run generate:prompts`

export const DISTILL = `Use this tool to distill relevant findings from a selection of raw tool outputs into preserved knowledge, in order to denoise key bits and parts of context.

THE PRUNABLE TOOLS LIST
A <prunable-tools> will show in context when outputs are available for distillation (you don't need to look for it). Each entry follows the format \`ID: tool, parameter (~token usage)\` (e.g., \`20: read, /path/to/file.ts (~1500 tokens)\`). You MUST select outputs by their numeric ID. THESE ARE YOUR ONLY VALID TARGETS.

THE PHILOSOPHY OF DISTILLATION
\`distill\` is your favored instrument for transforming raw tool outputs into preserved knowledge. This is not mere summarization; it is high-fidelity extraction that makes the original output obsolete.

Your distillation must be COMPLETE. Capture function signatures, type definitions, business logic, constraints, configuration values... EVERYTHING essential. Think of it as creating a high signal technical substitute so faithful that re-fetching the original would yield no additional value. Be thorough; be comprehensive; leave no ambiguity, ensure that your distillation stands alone, and is designed for easy retrieval and comprehension.

AIM FOR IMPACT. Distillation is most powerful when applied to outputs that contain signal buried in noise. A single line requires no distillation; a hundred lines of API documentation do. Make sure the distillation is meaningful.

THE WAYS OF DISTILL
\`distill\` when you have extracted the essence from tool outputs and the raw form has served its purpose.
Here are some examples:
EXPLORATION: You've read extensively and grasp the architecture. The original file contents are no longer needed; your understanding, synthesized, is sufficient.
PRESERVATION: Valuable technical details (signatures, logic, constraints) coexist with noise. Preserve the former; discard the latter.

Not everything should be distilled. Prefer keeping raw outputs when:
PRECISION MATTERS: You will edit the file, grep for exact strings, or need line-accurate references. Distillation sacrifices precision for essence.
UNCERTAINTY REMAINS: If you might need to re-examine the original, defer. Distillation is irreversible; be certain before you commit.

Before distilling, ask yourself: _"Will I need the raw output for upcoming work?"_ If you plan to edit a file you just read, keep it intact. Distillation is for completed exploration, not active work.

THE FORMAT OF DISTILL
\`targets\`: Array of objects, each containing:
\`id\`: Numeric ID (as string) from the \`<prunable-tools>\` list
\`distillation\`: Complete technical substitute for that tool output
`

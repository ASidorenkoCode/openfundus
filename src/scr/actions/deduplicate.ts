import { tool } from "@opencode-ai/plugin"
import type { PruneToolContext } from "./types"
import { executePruneOperation } from "./shared"
import type { PruneReason } from "../notification"
import { loadPrompt } from "../prompts"

const DISTILL_TOOL_DESCRIPTION = loadPrompt("distill-tool-spec")

export function createDistillTool(ctx: PruneToolContext): ReturnType<typeof tool> {
    return tool({
        description: DISTILL_TOOL_DESCRIPTION,
        args: {
            targets: tool.schema
                .array(
                    tool.schema.object({
                        id: tool.schema
                            .string()
                            .describe("Numeric ID from the <prunable-tools> list"),
                        distillation: tool.schema
                            .string()
                            .describe("Complete technical distillation for this tool output"),
                    }),
                )
                .describe("Tool outputs to distill, each pairing an ID with its distillation"),
        },
        async execute(args, toolCtx) {
            if (!args.targets || !Array.isArray(args.targets) || args.targets.length === 0) {
                ctx.logger.debug("Distill tool called without targets: " + JSON.stringify(args))
                throw new Error("Missing targets. Provide at least one { id, distillation } entry.")
            }

            for (const target of args.targets) {
                if (!target.id || typeof target.id !== "string" || target.id.trim() === "") {
                    ctx.logger.debug("Distill target missing id: " + JSON.stringify(target))
                    throw new Error(
                        "Each target must have an id (numeric string from <prunable-tools>).",
                    )
                }
                if (!target.distillation || typeof target.distillation !== "string") {
                    ctx.logger.debug(
                        "Distill target missing distillation: " + JSON.stringify(target),
                    )
                    throw new Error("Each target must have a distillation string.")
                }
            }

            const ids = args.targets.map((t) => t.id)
            const distillations = args.targets.map((t) => t.distillation)

            return executePruneOperation(
                ctx,
                toolCtx,
                ids,
                "extraction" as PruneReason,
                "Distill",
                distillations,
            )
        },
    })
}

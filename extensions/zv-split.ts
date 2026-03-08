import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildPiCommand, openCommandInNewSplit, openCommandInNewTab, type SplitDirection } from "./zv-core.ts";

async function openPiInSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	direction: SplitDirection,
	args: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	return openCommandInNewSplit(
		pi,
		direction,
		buildPiCommand(ctx.cwd, { prompt: args.trim().length > 0 ? args : undefined }),
	);
}

async function openPiInTab(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	return openCommandInNewTab(pi, ctx.cwd, buildPiCommand(ctx.cwd, { prompt: args.trim().length > 0 ? args : undefined }));
}

function registerSplitCommand(
	pi: ExtensionAPI,
	name: string,
	direction: SplitDirection,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			const result = await openPiInSplit(pi, ctx, direction, args);
			if (result.ok) {
				ctx.ui.notify(successMessage, "info");
			} else {
				ctx.ui.notify(`zellij split failed: ${result.error}`, "error");
			}
		},
	});
}

function registerTabCommand(
	pi: ExtensionAPI,
	name: string,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			const result = await openPiInTab(pi, ctx, args);
			if (result.ok) {
				ctx.ui.notify(successMessage, "info");
			} else {
				ctx.ui.notify(`zellij tab failed: ${result.error}`, "error");
			}
		},
	});
}

export default function zvSplitExtension(pi: ExtensionAPI) {
	registerSplitCommand(
		pi,
		"zv",
		"right",
		"Open a new right zellij pane and start a fresh pi session",
		"Opened a new pane to the right",
	);

	registerSplitCommand(
		pi,
		"zj",
		"down",
		"Open a new lower zellij pane and start a fresh pi session",
		"Opened a new pane below",
	);

	registerTabCommand(
		pi,
		"zt",
		"Open a new zellij tab and start a fresh pi session",
		"Opened a new tab",
	);
}

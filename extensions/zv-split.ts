import {
	buildSessionContext,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	buildPiCommand,
	formatPaneSuccessMessage,
	formatTabSuccessMessage,
	isInsideZellijSession,
	openCommandInNewSplit,
	openCommandInNewTab,
	type PiCommandOptions,
	type PiThinkingLevel,
	type SplitDirection,
} from "./zv-core.ts";

export type PiPlacement = SplitDirection | "tab";
type PiLaunchContext = Pick<ExtensionContext, "cwd">;
type PiContinuationContext = Pick<ExtensionContext, "cwd" | "sessionManager">;

export interface ZellijStartPiParams {
	placement?: PiPlacement;
	prompt?: string;
	continueSession?: boolean;
	provider?: string;
	model?: string;
	thinking?: PiThinkingLevel;
	title?: string;
}

interface OpenedPiSession {
	ok: true;
	placement: PiPlacement;
	paneId?: string;
	tabId?: string;
}

const THINKING_LEVELS: readonly PiThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

const ZELLIJ_START_PI_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		placement: {
			type: "string",
			enum: ["right", "down", "tab"],
			default: "tab",
			description: "Where to start Pi: a right split, lower split, or new tab. Defaults to tab.",
		},
		prompt: {
			type: "string",
			description: "Optional initial prompt for the new Pi session. The extension handles shell quoting.",
		},
		continueSession: {
			type: "boolean",
			default: false,
			description:
				"Clone the current active conversation into a separate session before starting Pi. Set true only when the user explicitly asks to continue or inherit the current history. Defaults to false for a fresh session.",
		},
		provider: {
			type: "string",
			description: "Optional Pi provider. Requires model; omit both to use Pi's normal session/default selection.",
		},
		model: {
			type: "string",
			description: "Optional Pi model pattern or ID, including provider/model and model:thinking forms.",
		},
		thinking: {
			type: "string",
			enum: THINKING_LEVELS,
			description: "Optional Pi thinking level for the new session.",
		},
		title: {
			type: "string",
			description: "Optional zellij pane or tab name.",
		},
	},
} as const;

function normalizePiPlacement(value: unknown): PiPlacement {
	return value === "right" || value === "down" || value === "tab" ? value : "tab";
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

function normalizeThinkingLevel(value: unknown): PiThinkingLevel | undefined {
	return typeof value === "string" && THINKING_LEVELS.includes(value as PiThinkingLevel)
		? (value as PiThinkingLevel)
		: undefined;
}

function getPlacementLabel(placement: PiPlacement): string {
	if (placement === "right") return "right split";
	if (placement === "down") return "lower split";
	return "tab";
}

async function openPiSession(
	pi: ExtensionAPI,
	ctx: PiLaunchContext,
	placement: PiPlacement,
	options: PiCommandOptions,
	title?: string,
): Promise<OpenedPiSession | { ok: false; error: string }> {
	const command = buildPiCommand(ctx.cwd, options);
	if (placement === "tab") {
		const result = await openCommandInNewTab(pi, ctx.cwd, command, { name: title });
		if (!result.ok) return result;
		return { ok: true, placement, tabId: result.tabId };
	}

	const result = await openCommandInNewSplit(pi, placement, command, { name: title });
	if (!result.ok) return result;
	return { ok: true, placement, paneId: result.paneId };
}

function createContinuationSession(
	ctx: PiContinuationContext,
): { ok: true; sessionFile: string } | { ok: false; error: string } {
	const sourceSessionFile = ctx.sessionManager.getSessionFile();
	if (!sourceSessionFile) {
		return { ok: false, error: "Cannot inherit history from an ephemeral session" };
	}

	const currentLeaf = ctx.sessionManager.getLeafEntry();
	if (!currentLeaf) {
		return { ok: false, error: "The current session has no conversation history to inherit" };
	}

	// During tool execution, the active leaf is the assistant message containing
	// this tool call. Exclude it so the child does not inherit a tool call without
	// its result.
	const continuationLeafId =
		currentLeaf.type === "message" && currentLeaf.message.role === "assistant"
			? currentLeaf.parentId
			: currentLeaf.id;
	if (!continuationLeafId) {
		return { ok: false, error: "The current session has no completed conversation history to inherit" };
	}

	try {
		const inheritedContext = buildSessionContext(ctx.sessionManager.getEntries(), continuationLeafId);
		if (inheritedContext.messages.length === 0) {
			return { ok: false, error: "The current session has no conversation history to inherit" };
		}

		const inheritedBranch = ctx.sessionManager.getBranch(continuationLeafId);
		const hasCompletedAssistantMessage = inheritedBranch.some(
			(entry) => entry.type === "message" && entry.message.role === "assistant",
		);
		if (hasCompletedAssistantMessage) {
			const sourceSession = SessionManager.open(sourceSessionFile, ctx.sessionManager.getSessionDir());
			const sessionFile = sourceSession.createBranchedSession(continuationLeafId);
			if (sessionFile) return { ok: true, sessionFile };
		}

		// A branch with only the triggering user message is not written by
		// createBranchedSession until it receives an assistant response. Fork the
		// file and move its active leaf instead so Pi can open it immediately.
		const continuationSession = SessionManager.forkFrom(
			sourceSessionFile,
			ctx.cwd,
			ctx.sessionManager.getSessionDir(),
		);
		continuationSession.branch(continuationLeafId);
		continuationSession.appendCustomEntry("pi-zellij-continuation");
		const sessionFile = continuationSession.getSessionFile();
		if (!sessionFile) {
			return { ok: false, error: "Failed to create a persistent continuation session" };
		}
		return { ok: true, sessionFile };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `Failed to clone the current session: ${message}` };
	}
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
			const prompt = normalizeOptionalString(args);
			const result = await openPiSession(pi, ctx, direction, { prompt });
			if (result.ok) {
				ctx.ui.notify(formatPaneSuccessMessage(successMessage, result.paneId), "info");
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
			const prompt = normalizeOptionalString(args);
			const result = await openPiSession(pi, ctx, "tab", { prompt });
			if (result.ok) {
				ctx.ui.notify(formatTabSuccessMessage(successMessage, result.tabId), "info");
			} else {
				ctx.ui.notify(`zellij tab failed: ${result.error}`, "error");
			}
		},
	});
}

function registerAgentPiTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "zellij_start_pi",
		label: "Start Pi in zellij",
		description:
			"Start another interactive Pi session in a zellij right split, lower split, or tab, with an optional initial prompt and model settings. Sessions are fresh by default; current history is inherited only when continueSession is explicitly true.",
		promptSnippet:
			"Start another interactive Pi agent in a zellij split or tab with an optional initial prompt, model settings, or explicitly inherited history.",
		promptGuidelines: [
			"Use zellij_start_pi when the user explicitly requests another Pi session or agent in a zellij split or tab, including a request with an initial prompt.",
			"Use zellij_start_pi with placement='tab' when the user says tab, placement='right' for a side pane, and placement='down' for a below/lower pane.",
			"zellij_start_pi starts a fresh session by default. Set continueSession=true only when the user explicitly asks the new Pi session to continue or inherit the current conversation.",
			"Pass Pi tasks through zellij_start_pi's prompt parameter and model choices through provider, model, and thinking; do not construct or quote a Pi shell command yourself.",
			"Do not start another Pi session proactively with zellij_start_pi without a user request.",
		],
		parameters: ZELLIJ_START_PI_PARAMETERS as any,
		executionMode: "sequential",
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as ZellijStartPiParams;
			if (!isInsideZellijSession()) {
				throw new Error("This tool must be run from inside an active zellij session");
			}

			const placement = normalizePiPlacement(params.placement);
			const prompt = normalizeOptionalString(params.prompt);
			const provider = normalizeOptionalString(params.provider);
			const model = normalizeOptionalString(params.model);
			const thinking = normalizeThinkingLevel(params.thinking);
			const title = normalizeOptionalString(params.title);

			if (params.provider !== undefined && !provider) {
				throw new Error("provider must be a non-empty string");
			}
			if (params.model !== undefined && !model) {
				throw new Error("model must be a non-empty string");
			}
			if (provider && !model) {
				throw new Error("provider requires model");
			}
			if (params.thinking !== undefined && !thinking) {
				throw new Error(`Invalid thinking level: ${String(params.thinking)}`);
			}

			let sessionFile: string | undefined;
			if (params.continueSession === true) {
				const continuation = createContinuationSession(ctx);
				if (!continuation.ok) throw new Error(continuation.error);
				sessionFile = continuation.sessionFile;
			}

			const result = await openPiSession(
				pi,
				ctx,
				placement,
				{ sessionFile, prompt, provider, model, thinking },
				title,
			);
			if (!result.ok) {
				throw new Error(result.error);
			}

			const historyLabel = sessionFile ? "a Pi session with inherited history" : "a fresh Pi session";
			return {
				content: [
					{
						type: "text",
						text: `Opened ${historyLabel} in a zellij ${getPlacementLabel(result.placement)}.`,
					},
				],
				details: {
					placement: result.placement,
					cwd: ctx.cwd,
					history: sessionFile ? "inherited" : "fresh",
					...(sessionFile ? { sessionFile } : {}),
					...(provider ? { provider } : {}),
					...(model ? { model } : {}),
					...(thinking ? { thinking } : {}),
					...(title ? { title } : {}),
					...(result.paneId ? { paneId: result.paneId } : {}),
					...(result.tabId ? { tabId: result.tabId } : {}),
				},
			};
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

	registerAgentPiTool(pi);
}

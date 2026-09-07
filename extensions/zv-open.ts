import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	buildShellCommand,
	formatPaneSuccessMessage,
	openCommandInFloatingPane as openCommandInFloatingZellijPane,
	openCommandInNewSplit,
	openCommandInNewTab,
	type PaneOpenResult,
	type SplitDirection,
	type TabOpenResult,
} from "./zv-core.ts";

const DEFAULT_FLOATING_PANE_OPTIONS = {
	width: "90%",
	height: "90%",
	x: "5%",
	y: "5%",
} as const;

const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const SETTINGS_SECTION_NAMES = ["pi-zellij", "pi-zv"] as const;
const RESERVED_COMMAND_NAMES = new Set([
	"login",
	"logout",
	"model",
	"scoped-models",
	"settings",
	"resume",
	"new",
	"name",
	"session",
	"tree",
	"fork",
	"compact",
	"copy",
	"export",
	"share",
	"reload",
	"hotkeys",
	"changelog",
	"quit",
	"exit",
	"help",
	"review",
	"review-diff",
	"zv",
	"zj",
	"zt",
	"zo",
	"zoh",
	"zz",
	"zzh",
	"zrv",
	"zrh",
	"zcv",
	"zch",
]);

interface ConfiguredFloatingCommandInput {
	run?: string;
	acceptArgs?: boolean;
	description?: string;
	disabled?: boolean;
}

interface ConfiguredFloatingCommand {
	run: string;
	acceptArgs: boolean;
	description: string;
}

type TerminalPlacement = SplitDirection | "tab" | "floating";

type OpenToolContext = Pick<ExtensionContext, "cwd">;

interface ZellijOpenTerminalParams {
	command: string;
	placement?: TerminalPlacement;
	title?: string;
}

interface OpenedTerminal {
	ok: true;
	placement: TerminalPlacement;
	command: string;
	paneId?: string;
	tabId?: string;
}

const ZELLIJ_OPEN_TERMINAL_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["command"],
	properties: {
		command: {
			type: "string",
			description: "Interactive terminal command to run, for example k9s, htop, lazygit, or npm run dev",
		},
		placement: {
			type: "string",
			enum: ["right", "down", "tab", "floating"],
			default: "tab",
			description: "Where to open the command. Use floating for a 90% by 90% floating pane.",
		},
		title: {
			type: "string",
			description: "Optional zellij pane or tab name. Defaults to the command.",
		},
	},
} as const;

async function openToolInSplit(
	pi: ExtensionAPI,
	ctx: OpenToolContext,
	direction: SplitDirection,
	args: string,
	name?: string,
): Promise<PaneOpenResult> {
	return openCommandInNewSplit(pi, direction, buildShellCommand(ctx.cwd, args.trim()), { name });
}

async function openToolInFloatingPane(
	pi: ExtensionAPI,
	ctx: OpenToolContext,
	command: string,
	name?: string,
): Promise<PaneOpenResult> {
	return openCommandInFloatingZellijPane(pi, buildShellCommand(ctx.cwd, command.trim()), {
		name,
		...DEFAULT_FLOATING_PANE_OPTIONS,
	});
}

async function openToolInTab(
	pi: ExtensionAPI,
	ctx: OpenToolContext,
	command: string,
	name?: string,
): Promise<TabOpenResult> {
	return openCommandInNewTab(pi, ctx.cwd, buildShellCommand(ctx.cwd, command.trim()), { name });
}

function registerOpenCommand(
	pi: ExtensionAPI,
	name: string,
	direction: SplitDirection,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!command) {
				ctx.ui.notify(`Usage: /${name} <command...>`, "warning");
				return;
			}

			const result = await openToolInSplit(pi, ctx, direction, command);
			if (result.ok) {
				ctx.ui.notify(formatPaneSuccessMessage(successMessage, result.paneId), "info");
			} else {
				ctx.ui.notify(`tool split failed: ${result.error}`, "error");
			}
		},
	});
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			console.warn(`[pi-zellij] Ignoring non-object settings file: ${path}`);
			return undefined;
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-zellij] Failed to read settings from ${path}: ${message}`);
		return undefined;
	}
}

function readPiZellijCommands(settingsPath: string): Record<string, unknown> {
	const settings = readJsonFile(settingsPath);
	for (const sectionName of SETTINGS_SECTION_NAMES) {
		const section = settings?.[sectionName];
		if (!section) {
			continue;
		}
		if (typeof section !== "object" || Array.isArray(section)) {
			console.warn(`[pi-zellij] Ignoring invalid \"${sectionName}\" settings in ${settingsPath}`);
			continue;
		}

		const commands = (section as { commands?: unknown }).commands;
		if (commands === undefined) {
			continue;
		}
		if (typeof commands !== "object" || Array.isArray(commands)) {
			console.warn(`[pi-zellij] Ignoring invalid \"${sectionName}.commands\" settings in ${settingsPath}`);
			continue;
		}

		return commands as Record<string, unknown>;
	}

	return {};
}

function isValidCommandName(value: string): boolean {
	return /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

function getDefaultConfiguredCommandDescription(commandName: string, run: string): string {
	return `Open ${run} in a floating zellij pane via /${commandName}`;
}

function normalizeConfiguredFloatingCommand(
	commandName: string,
	value: unknown,
	settingsPath: string,
): ConfiguredFloatingCommand | null | undefined {
	if (!isValidCommandName(commandName)) {
		console.warn(`[pi-zellij] Skipping invalid configured command name \"${commandName}\" from ${settingsPath}`);
		return undefined;
	}

	if (typeof value === "string") {
		const run = value.trim();
		if (!run) {
			console.warn(`[pi-zellij] Skipping empty configured command /${commandName} from ${settingsPath}`);
			return undefined;
		}
		return {
			run,
			acceptArgs: false,
			description: getDefaultConfiguredCommandDescription(commandName, run),
		};
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		console.warn(`[pi-zellij] Skipping invalid configured command /${commandName} from ${settingsPath}`);
		return undefined;
	}

	const config = value as ConfiguredFloatingCommandInput;
	if (config.disabled) {
		return null;
	}

	const run = typeof config.run === "string" ? config.run.trim() : "";
	if (!run) {
		console.warn(`[pi-zellij] Skipping configured command /${commandName} without a valid \"run\" value from ${settingsPath}`);
		return undefined;
	}

	return {
		run,
		acceptArgs: config.acceptArgs === true,
		description:
			typeof config.description === "string" && config.description.trim().length > 0
				? config.description.trim()
				: getDefaultConfiguredCommandDescription(commandName, run),
	};
}

function loadConfiguredFloatingCommands(cwd: string): Map<string, ConfiguredFloatingCommand> {
	const configuredCommands = new Map<string, ConfiguredFloatingCommand>();
	const settingsPaths = [GLOBAL_SETTINGS_PATH, join(cwd, ".pi", "settings.json")];

	for (const settingsPath of settingsPaths) {
		const commands = readPiZellijCommands(settingsPath);
		for (const [commandName, value] of Object.entries(commands)) {
			const normalized = normalizeConfiguredFloatingCommand(commandName, value, settingsPath);
			if (normalized === null) {
				configuredCommands.delete(commandName);
				continue;
			}
			if (!normalized) {
				continue;
			}
			configuredCommands.set(commandName, normalized);
		}
	}

	return configuredCommands;
}

function registerConfiguredFloatingCommand(
	pi: ExtensionAPI,
	commandName: string,
	config: ConfiguredFloatingCommand,
): void {
	pi.registerCommand(commandName, {
		description: config.description,
		handler: async (args, ctx) => {
			const trimmedArgs = args.trim();
			if (trimmedArgs.length > 0 && !config.acceptArgs) {
				ctx.ui.notify(`Usage: /${commandName}`, "warning");
				return;
			}

			const command = trimmedArgs.length > 0 ? `${config.run} ${trimmedArgs}` : config.run;
			const result = await openToolInFloatingPane(pi, ctx, command, commandName);
			if (result.ok) {
				ctx.ui.notify(formatPaneSuccessMessage(`Opened /${commandName} in a floating pane`, result.paneId), "info");
			} else {
				ctx.ui.notify(`floating pane failed: ${result.error}`, "error");
			}
		},
	});
}

function normalizeTerminalPlacement(value: unknown): TerminalPlacement {
	return value === "right" || value === "down" || value === "tab" || value === "floating" ? value : "tab";
}

function getPlacementLabel(placement: TerminalPlacement): string {
	if (placement === "right") {
		return "right split";
	}
	if (placement === "down") {
		return "lower split";
	}
	if (placement === "floating") {
		return "floating pane";
	}
	return "tab";
}

async function openTerminalCommand(
	pi: ExtensionAPI,
	ctx: OpenToolContext,
	params: ZellijOpenTerminalParams,
): Promise<OpenedTerminal | { ok: false; error: string }> {
	const command = typeof params.command === "string" ? params.command.trim() : "";
	if (!command) {
		return { ok: false, error: "Specify a command to open" };
	}

	const placement = normalizeTerminalPlacement(params.placement);
	const title = params.title?.trim() || command;

	if (placement === "tab") {
		const result = await openToolInTab(pi, ctx, command, title);
		if (!result.ok) {
			return result;
		}
		return { ok: true, placement, command, tabId: result.tabId };
	}

	const result = placement === "floating"
		? await openToolInFloatingPane(pi, ctx, command, title)
		: await openToolInSplit(pi, ctx, placement, command, title);
	if (!result.ok) {
		return result;
	}

	return { ok: true, placement, command, paneId: result.paneId };
}

function registerAgentTerminalTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "zellij_open_terminal",
		label: "Open zellij terminal",
		description:
			"Open an interactive terminal command in zellij as a right split, lower split, new tab, or floating pane. Use for user-requested Pi sessions, TUIs, logs, dev servers, watches, or long-running terminal views.",
		promptSnippet:
			"Open an interactive terminal command or another Pi session in zellij when the user asks for it in another pane, split, tab, or floating terminal.",
		promptGuidelines: [
			"Use zellij_open_terminal only when the user explicitly asks to open a command in zellij, another pane, split, tab, or floating terminal.",
			"Use zellij_open_terminal from pi-zellij when the user requests another Pi session in a split or tab, including an initial prompt. Prefer zellij_start_pi when it is available.",
			"Use zellij_open_terminal with placement='tab' when the user says tab, placement='right' for a side pane, placement='down' for a below/lower pane, and placement='floating' for a floating pane.",
			"Use zellij_open_terminal for interactive TUIs like k9s, lazygit, htop, hunk, log tails, dev servers, or watches; do not use bash for these unless the user wants captured output.",
			"Do not open terminals proactively with zellij_open_terminal without a user request.",
		],
		parameters: ZELLIJ_OPEN_TERMINAL_PARAMETERS as any,
		executionMode: "sequential",
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			const params = rawParams as ZellijOpenTerminalParams;
			const result = await openTerminalCommand(pi, ctx, params);
			if (!result.ok) {
				throw new Error(result.error);
			}

			return {
				content: [{ type: "text", text: `Opened ${result.command} in a zellij ${getPlacementLabel(result.placement)}.` }],
				details: {
					command: result.command,
					placement: result.placement,
					cwd: ctx.cwd,
					...(result.paneId ? { paneId: result.paneId } : {}),
					...(result.tabId ? { tabId: result.tabId } : {}),
				},
			};
		},
	});
}

export default function zvOpenExtension(pi: ExtensionAPI) {
	registerOpenCommand(
		pi,
		"zo",
		"right",
		"Open a new right pane and run any shell command there",
		"Opened a tool pane to the right",
	);
	registerOpenCommand(
		pi,
		"zoh",
		"down",
		"Open a new lower pane and run any shell command there",
		"Opened a tool pane below",
	);

	const registeredConfiguredNames = new Set<string>();
	for (const [commandName, config] of loadConfiguredFloatingCommands(process.cwd())) {
		if (RESERVED_COMMAND_NAMES.has(commandName) || registeredConfiguredNames.has(commandName)) {
			console.warn(`[pi-zellij] Skipping configured command /${commandName}: command already exists`);
			continue;
		}
		registerConfiguredFloatingCommand(pi, commandName, config);
		registeredConfiguredNames.add(commandName);
	}

	registerAgentTerminalTool(pi);
}

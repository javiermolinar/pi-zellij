import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	buildShellCommand,
	formatPaneSuccessMessage,
	openCommandInFloatingPane as openCommandInFloatingZellijPane,
	openCommandInNewSplit,
	type PaneOpenResult,
	type SplitDirection,
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

async function openToolInSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	direction: SplitDirection,
	args: string,
): Promise<PaneOpenResult> {
	return openCommandInNewSplit(pi, direction, buildShellCommand(ctx.cwd, args.trim()));
}

async function openToolInFloatingPane(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	command: string,
	name?: string,
): Promise<PaneOpenResult> {
	return openCommandInFloatingZellijPane(pi, buildShellCommand(ctx.cwd, command.trim()), {
		name,
		...DEFAULT_FLOATING_PANE_OPTIONS,
	});
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
}

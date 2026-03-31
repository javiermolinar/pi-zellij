import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isInsideZellijSession, resetCurrentPaneColor, setCurrentPaneColor } from "./zv-core.ts";

const DEFAULT_DONE_BG = "#17352a";
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const SETTINGS_SECTION_NAMES = ["pi-zellij", "pi-zv"] as const;

interface PaneHighlightConfigInput {
	enabled?: boolean;
	doneBg?: string;
	doneFg?: string;
	workingBg?: string;
	workingFg?: string;
}

interface PaneHighlightConfig {
	enabled: boolean;
	doneBg: string;
	doneFg?: string;
	workingBg?: string;
	workingFg?: string;
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

function readPaneHighlightSetting(settingsPath: string): unknown {
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
		const paneHighlight = (section as { paneHighlight?: unknown }).paneHighlight;
		if (paneHighlight === undefined) {
			continue;
		}
		return paneHighlight;
	}
	return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePaneHighlightConfig(value: unknown, settingsPath: string): Partial<PaneHighlightConfig> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "boolean") {
		return { enabled: value };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		console.warn(`[pi-zellij] Ignoring invalid paneHighlight settings in ${settingsPath}`);
		return undefined;
	}

	const config = value as PaneHighlightConfigInput;
	return {
		enabled: config.enabled !== false,
		doneBg: normalizeOptionalString(config.doneBg),
		doneFg: normalizeOptionalString(config.doneFg),
		workingBg: normalizeOptionalString(config.workingBg),
		workingFg: normalizeOptionalString(config.workingFg),
	};
}

function loadPaneHighlightConfig(cwd: string): PaneHighlightConfig {
	let merged: Partial<PaneHighlightConfig> = { enabled: false };

	for (const settingsPath of [GLOBAL_SETTINGS_PATH, join(cwd, ".pi", "settings.json")]) {
		const normalized = normalizePaneHighlightConfig(readPaneHighlightSetting(settingsPath), settingsPath);
		if (!normalized) {
			continue;
		}
		merged = { ...merged, ...normalized };
	}

	return {
		enabled: merged.enabled === true,
		doneBg: merged.doneBg ?? DEFAULT_DONE_BG,
		doneFg: merged.doneFg,
		workingBg: merged.workingBg,
		workingFg: merged.workingFg,
	};
}

function hasWorkingColors(config: PaneHighlightConfig): boolean {
	return Boolean(config.workingBg || config.workingFg);
}

export default function zvHighlightExtension(pi: ExtensionAPI) {
	let config = loadPaneHighlightConfig(process.cwd());
	let lastActionError: string | undefined;

	function warnActionError(message: string): void {
		if (lastActionError === message) {
			return;
		}
		lastActionError = message;
		console.warn(`[pi-zellij] ${message}`);
	}

	function clearActionError(): void {
		lastActionError = undefined;
	}

	async function refreshConfig(cwd: string): Promise<void> {
		const wasEnabled = config.enabled;
		config = loadPaneHighlightConfig(cwd);
		if ((!wasEnabled && !config.enabled) || !isInsideZellijSession()) {
			return;
		}

		const result = await resetCurrentPaneColor(pi);
		if (!result.ok) {
			warnActionError(`pane highlight reset failed: ${result.error}`);
			return;
		}
		clearActionError();
	}

	async function resetPaneIfEnabled(): Promise<void> {
		if (!config.enabled || !isInsideZellijSession()) {
			return;
		}

		const result = await resetCurrentPaneColor(pi);
		if (!result.ok) {
			warnActionError(`pane highlight reset failed: ${result.error}`);
			return;
		}
		clearActionError();
	}

	async function applyWorkingState(): Promise<void> {
		if (!config.enabled || !isInsideZellijSession()) {
			return;
		}
		if (!hasWorkingColors(config)) {
			await resetPaneIfEnabled();
			return;
		}

		const result = await setCurrentPaneColor(pi, {
			bg: config.workingBg,
			fg: config.workingFg,
		});
		if (!result.ok) {
			warnActionError(`pane highlight update failed: ${result.error}`);
			return;
		}
		clearActionError();
	}

	async function applyDoneState(): Promise<void> {
		if (!config.enabled || !isInsideZellijSession()) {
			return;
		}

		const result = await setCurrentPaneColor(pi, {
			bg: config.doneBg,
			fg: config.doneFg,
		});
		if (!result.ok) {
			warnActionError(`pane highlight update failed: ${result.error}`);
			return;
		}
		clearActionError();
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshConfig(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await refreshConfig(ctx.cwd);
	});

	pi.on("session_fork", async (_event, ctx) => {
		await refreshConfig(ctx.cwd);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await refreshConfig(ctx.cwd);
	});

	pi.on("agent_start", async () => {
		await applyWorkingState();
	});

	pi.on("agent_end", async () => {
		await applyDoneState();
	});

	pi.on("session_shutdown", async () => {
		await resetPaneIfEnabled();
	});
}

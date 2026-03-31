import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isInsideZellijSession, resetCurrentPaneColor, setCurrentPaneColor } from "./zv-core.ts";

const DEFAULT_DONE_BG = "#17352a";
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const SETTINGS_SECTION_NAMES = ["pi-zellij", "pi-zv"] as const;
const FOCUS_POLL_INTERVAL_MS = 400;
const FOCUS_QUERY_TIMEOUT_MS = 2000;

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

interface MessageLike {
	role?: unknown;
	stopReason?: unknown;
	content?: unknown;
}

type JsonRecord = Record<string, unknown>;

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

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePaneId(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
		return `terminal_${value}`;
	}
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	if (/^(?:terminal|plugin)_\d+$/.test(trimmed)) {
		return trimmed;
	}
	if (/^\d+$/.test(trimmed)) {
		return `terminal_${trimmed}`;
	}
	return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (value === "true") return true;
		if (value === "false") return false;
	}
	return undefined;
}

function getPaneEntries(parsed: unknown): JsonRecord[] {
	if (Array.isArray(parsed)) {
		return parsed.filter(isRecord);
	}
	if (!isRecord(parsed)) {
		return [];
	}

	for (const key of ["panes", "items", "data", "results"]) {
		const candidate = parsed[key];
		if (Array.isArray(candidate)) {
			return candidate.filter(isRecord);
		}
	}

	return [parsed];
}

function getPaneIdFromEntry(entry: JsonRecord): string | undefined {
	for (const key of ["pane_id", "paneId", "id", "terminal_id", "terminalId"]) {
		const normalized = normalizePaneId(entry[key]);
		if (normalized) {
			return normalized;
		}
	}

	const nestedPane = entry.pane;
	if (isRecord(nestedPane)) {
		return getPaneIdFromEntry(nestedPane);
	}

	return undefined;
}

function getFocusedStateFromEntry(entry: JsonRecord): boolean | undefined {
	for (const key of ["is_focused", "focused", "isFocused", "active", "is_active", "isActive"]) {
		const normalized = readBoolean(entry[key]);
		if (normalized !== undefined) {
			return normalized;
		}
	}

	const nestedState = entry.state;
	if (isRecord(nestedState)) {
		return getFocusedStateFromEntry(nestedState);
	}

	const nestedPane = entry.pane;
	if (isRecord(nestedPane)) {
		return getFocusedStateFromEntry(nestedPane);
	}

	return undefined;
}

function hasVisibleAssistantContent(message: MessageLike): boolean {
	if (typeof message.content === "string") {
		return message.content.trim().length > 0;
	}
	if (!Array.isArray(message.content)) {
		return false;
	}
	return message.content.length > 0;
}

function shouldHighlightAfterAgentEnd(messages: readonly unknown[]): boolean {
	const assistantMessages = messages.filter((message): message is MessageLike => {
		return isRecord(message) && message.role === "assistant";
	});
	if (assistantMessages.length === 0) {
		return false;
	}

	const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]!;
	if (lastAssistantMessage.stopReason === "aborted") {
		return false;
	}
	return hasVisibleAssistantContent(lastAssistantMessage);
}

export default function zvHighlightExtension(pi: ExtensionAPI) {
	let config = loadPaneHighlightConfig(process.cwd());
	let lastActionError: string | undefined;
	let focusPollTimer: ReturnType<typeof setInterval> | undefined;
	let focusPollInFlight = false;
	let shouldClearOnRefocus = false;
	let sawPaneBlurSinceDone = false;

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

	function stopFocusPolling(): void {
		if (focusPollTimer) {
			clearInterval(focusPollTimer);
			focusPollTimer = undefined;
		}
		focusPollInFlight = false;
		shouldClearOnRefocus = false;
		sawPaneBlurSinceDone = false;
	}

	async function getCurrentPaneFocusedState(): Promise<boolean | undefined> {
		if (!isInsideZellijSession()) {
			return undefined;
		}

		const currentPaneId = normalizePaneId(process.env.ZELLIJ_PANE_ID);
		if (!currentPaneId) {
			return undefined;
		}

		const result = await pi.exec("zellij", ["action", "list-panes", "--json", "--state"], {
			timeout: FOCUS_QUERY_TIMEOUT_MS,
		});
		if (result.killed) {
			warnActionError("pane focus query failed: zellij command timed out");
			return undefined;
		}
		if (result.code !== 0) {
			warnActionError(`pane focus query failed: ${result.stderr.trim() || result.stdout.trim() || `zellij exited with code ${result.code}`}`);
			return undefined;
		}

		try {
			const parsed = JSON.parse(result.stdout) as unknown;
			for (const entry of getPaneEntries(parsed)) {
				if (getPaneIdFromEntry(entry) !== currentPaneId) {
					continue;
				}
				const focused = getFocusedStateFromEntry(entry);
				if (focused !== undefined) {
					clearActionError();
					return focused;
				}
			}
			warnActionError("pane focus query failed: could not determine current pane focus state");
			return undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnActionError(`pane focus query failed: ${message}`);
			return undefined;
		}
	}

	async function refreshConfig(cwd: string): Promise<void> {
		const wasEnabled = config.enabled;
		config = loadPaneHighlightConfig(cwd);
		if ((!wasEnabled && !config.enabled) || !isInsideZellijSession()) {
			stopFocusPolling();
			return;
		}

		stopFocusPolling();
		const result = await resetCurrentPaneColor(pi);
		if (!result.ok) {
			warnActionError(`pane highlight reset failed: ${result.error}`);
			return;
		}
		clearActionError();
	}

	async function resetPaneIfEnabled(): Promise<void> {
		stopFocusPolling();
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
		stopFocusPolling();
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

	async function pollFocusForReset(): Promise<void> {
		if (!shouldClearOnRefocus || focusPollInFlight) {
			return;
		}

		focusPollInFlight = true;
		try {
			const focused = await getCurrentPaneFocusedState();
			if (focused === undefined) {
				return;
			}
			if (!sawPaneBlurSinceDone) {
				if (!focused) {
					sawPaneBlurSinceDone = true;
				}
				return;
			}
			if (!focused) {
				return;
			}
			await resetPaneIfEnabled();
		} finally {
			focusPollInFlight = false;
		}
	}

	async function armFocusBasedReset(): Promise<void> {
		stopFocusPolling();
		if (!config.enabled || !isInsideZellijSession() || !process.env.ZELLIJ_PANE_ID) {
			return;
		}

		shouldClearOnRefocus = true;
		const focused = await getCurrentPaneFocusedState();
		sawPaneBlurSinceDone = focused === false;
		focusPollTimer = setInterval(() => {
			void pollFocusForReset();
		}, FOCUS_POLL_INTERVAL_MS);
	}

	async function applyDoneState(messages: readonly unknown[]): Promise<void> {
		if (!config.enabled || !isInsideZellijSession()) {
			return;
		}
		if (!shouldHighlightAfterAgentEnd(messages)) {
			await resetPaneIfEnabled();
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
		await armFocusBasedReset();
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

	pi.on("input", async () => {
		await resetPaneIfEnabled();
		return { action: "continue" };
	});

	pi.on("agent_start", async () => {
		await applyWorkingState();
	});

	pi.on("agent_end", async (event) => {
		await applyDoneState(event.messages);
	});

	pi.on("session_shutdown", async () => {
		await resetPaneIfEnabled();
	});
}

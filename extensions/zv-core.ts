import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ZELLIJ_TIMEOUT_MS = 5000;

export type SplitDirection = "right" | "down";

interface ZellijExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}

function isInsideZellijSession(): boolean {
	return Boolean(process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ_PANE_ID);
}

export function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPiCommand(cwd: string, options?: { sessionFile?: string; prompt?: string }): string {
	const commandParts = ["cd", shellEscape(cwd), "&&", "exec", "pi"];
	if (options?.sessionFile) {
		commandParts.push("--session", shellEscape(options.sessionFile));
	}
	const prompt = options?.prompt?.trim();
	if (prompt) {
		commandParts.push(shellEscape(prompt));
	}
	return commandParts.join(" ");
}

export function buildShellCommand(cwd: string, command: string): string {
	return ["cd", shellEscape(cwd), "&&", "exec", "sh", "-lc", shellEscape(command)].join(" ");
}

async function execZellij(pi: ExtensionAPI, args: string[]): Promise<ZellijExecResult> {
	const result = await pi.exec("zellij", args, { timeout: ZELLIJ_TIMEOUT_MS });
	if (result.killed) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: "zellij command timed out",
		};
	}
	if (result.code !== 0) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: result.stderr.trim() || result.stdout.trim() || `zellij exited with code ${result.code}`,
		};
	}
	return {
		ok: true,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

export async function openCommandInNewSplit(
	pi: ExtensionAPI,
	direction: SplitDirection,
	command: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!isInsideZellijSession()) {
		return { ok: false, error: "This command must be run from inside an active zellij session" };
	}

	const result = await execZellij(pi, ["run", "--direction", direction, "--", "sh", "-lc", command]);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to open a new zellij pane" };
	}

	return { ok: true };
}

export async function openCommandInFloatingPane(
	pi: ExtensionAPI,
	command: string,
	options?: { name?: string; width?: string; height?: string; x?: string; y?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!isInsideZellijSession()) {
		return { ok: false, error: "This command must be run from inside an active zellij session" };
	}

	const args = ["run", "--floating"];
	if (options?.name) args.push("--name", options.name);
	if (options?.width) args.push("--width", options.width);
	if (options?.height) args.push("--height", options.height);
	if (options?.x) args.push("-x", options.x);
	if (options?.y) args.push("-y", options.y);
	args.push("--", "sh", "-lc", command);

	const result = await execZellij(pi, args);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to open a new floating zellij pane" };
	}

	return { ok: true };
}

export async function openCommandInNewTab(
	pi: ExtensionAPI,
	cwd: string,
	command: string,
	options?: { name?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!isInsideZellijSession()) {
		return { ok: false, error: "This command must be run from inside an active zellij session" };
	}

	const newTabArgs = ["action", "new-tab", "--cwd", cwd];
	if (options?.name) {
		newTabArgs.push("--name", options.name);
	}

	const newTabResult = await execZellij(pi, newTabArgs);
	if (!newTabResult.ok) {
		return { ok: false, error: newTabResult.error || "Failed to open a new zellij tab" };
	}

	const writeCommandResult = await execZellij(pi, ["action", "write-chars", command]);
	if (!writeCommandResult.ok) {
		return { ok: false, error: writeCommandResult.error || "Failed to write command to new zellij tab" };
	}

	const submitCommandResult = await execZellij(pi, ["action", "write", "10"]);
	if (!submitCommandResult.ok) {
		return { ok: false, error: submitCommandResult.error || "Failed to start command in new zellij tab" };
	}

	return { ok: true };
}

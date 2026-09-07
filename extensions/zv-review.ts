import {
	CONFIG_DIR_NAME,
	getAgentDir,
	stripFrontmatter,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildPiCommand,
	formatPaneSuccessMessage,
	openCommandInNewSplit,
	type PaneOpenResult,
	type SplitDirection,
} from "./zv-core.ts";

const REVIEW_TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "templates", "review.md");

type ReviewMode = "general" | "bugs" | "refactor" | "tests" | "diff";

interface ReviewRequest {
	mode: ReviewMode;
	targetOrFocus?: string;
}

function getReviewUsage(commandName: string): string {
	return `Usage: /${commandName}  (defaults to --diff)  |  /${commandName} [--bugs|--refactor|--tests] <target>  |  /${commandName} --diff [focus]`;
}

function parseReviewArgs(args: string): { ok: true; request: ReviewRequest } | { ok: false; error: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { ok: true, request: { mode: "diff" } };
	}

	const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
	let mode: ReviewMode = "general";
	let modeWasExplicit = false;
	let index = 0;

	while (index < tokens.length && tokens[index].startsWith("--")) {
		const token = tokens[index];
		let nextMode: ReviewMode | undefined;
		if (token === "--bugs") nextMode = "bugs";
		if (token === "--refactor") nextMode = "refactor";
		if (token === "--tests") nextMode = "tests";
		if (token === "--diff") nextMode = "diff";
		if (!nextMode) {
			return { ok: false, error: `Unknown review flag: ${token}` };
		}
		if (modeWasExplicit) {
			return { ok: false, error: "Use only one review mode flag at a time" };
		}
		mode = nextMode;
		modeWasExplicit = true;
		index += 1;
	}

	const targetOrFocus = tokens.slice(index).join(" ").trim() || undefined;
	if (mode !== "diff" && !targetOrFocus) {
		return { ok: false, error: "Specify a file or directory to review" };
	}

	return { ok: true, request: { mode, targetOrFocus } };
}

function getGitHubPullRequestUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/.test(trimmed) ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReviewSkillSetting(settingsPath: string): string | null | undefined {
	let settings: unknown;
	try {
		settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read settings from ${settingsPath}: ${message}`);
	}

	if (!isRecord(settings)) {
		throw new Error(`Expected a settings object in ${settingsPath}`);
	}
	const section = settings["pi-zellij"];
	if (section === undefined) return undefined;
	if (!isRecord(section)) {
		throw new Error(`pi-zellij must be an object in ${settingsPath}`);
	}
	const review = section.review;
	if (review === undefined) return undefined;
	if (!isRecord(review)) {
		throw new Error(`pi-zellij.review must be an object in ${settingsPath}`);
	}
	const skill = review.skill;
	if (skill === undefined || skill === null) return skill;
	if (typeof skill !== "string" || !skill.trim()) {
		throw new Error(`pi-zellij.review.skill must be a non-empty skill name or null in ${settingsPath}`);
	}
	return skill.trim();
}

function loadReviewSkill(ctx: ExtensionCommandContext): string | undefined {
	const settingsPaths = [join(getAgentDir(), "settings.json")];
	if (ctx.isProjectTrusted()) {
		settingsPaths.push(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"));
	}

	let skill: string | null | undefined;
	for (const settingsPath of settingsPaths) {
		const value = readReviewSkillSetting(settingsPath);
		if (value !== undefined) skill = value;
	}
	return skill ?? undefined;
}

function buildReviewScope(request: ReviewRequest): string {
	const pullRequestUrl = getGitHubPullRequestUrl(request.targetOrFocus);
	const modeInstruction =
		request.mode === "bugs"
			? "Focus on correctness issues, runtime failures, bad assumptions, and edge cases."
			: request.mode === "refactor"
				? "Focus on simplifications, structure, naming, duplication, and maintainability while preserving behavior."
				: request.mode === "tests"
					? "Focus on missing coverage, brittle assertions, and untested edge cases."
					: "Focus on correctness, readability, maintainability, and missing tests.";

	if (pullRequestUrl) {
		return `Review GitHub pull request ${pullRequestUrl}. Use the gh CLI to inspect it, including gh pr view ${pullRequestUrl} and gh pr diff ${pullRequestUrl}. ${modeInstruction} Prioritize the changed code, likely regressions, and missing tests before adding lower-priority notes.`;
	}

	if (request.mode === "diff") {
		const focus = request.targetOrFocus ? ` Extra focus: ${request.targetOrFocus}.` : "";
		return `Review the current git diff in this repository.${focus} Prioritize regressions, correctness issues, risky edge cases, and missing tests.`;
	}

	return `Review ${request.targetOrFocus} from the current project. ${modeInstruction} If the target is a directory, review the most relevant files within that scope.`;
}

function buildReviewPrompt(request: ReviewRequest, ctx: ExtensionCommandContext): string {
	const scope = `${buildReviewScope(request)} Do not edit files unless asked.`;
	const skillName = loadReviewSkill(ctx);
	if (!skillName) {
		return `${readFileSync(REVIEW_TEMPLATE_PATH, "utf8").trim()}\n\n${scope}`;
	}

	const skill = ctx.getSystemPromptOptions().skills?.find((entry) => entry.name === skillName);
	if (!skill) {
		throw new Error(
			`Review skill "${skillName}" is not available in this session. Enable or install it and run /reload, or set pi-zellij.review.skill to null.`,
		);
	}

	let body: string;
	try {
		body = stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
		if (!body) throw new Error("Skill instructions are empty");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot load review skill "${skillName}" from ${skill.filePath}: ${message}`);
	}

	// Expand before launching, as Pi does for /skill:name. This validates the file
	// and carries even CLI-only skills into the child without rediscovering them.
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>\n\n${scope}`;
}

async function openReviewSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	direction: SplitDirection,
	request: ReviewRequest,
): Promise<PaneOpenResult> {
	try {
		const prompt = buildReviewPrompt(request, ctx);
		return await openCommandInNewSplit(pi, direction, buildPiCommand(ctx.cwd, { prompt }));
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function registerReviewCommand(
	pi: ExtensionAPI,
	name: string,
	direction: SplitDirection,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			const parsed = parseReviewArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(`${parsed.error}. ${getReviewUsage(name)}`, "warning");
				return;
			}

			const result = await openReviewSplit(pi, ctx, direction, parsed.request);
			if (result.ok) {
				ctx.ui.notify(formatPaneSuccessMessage(successMessage, result.paneId), "info");
			} else {
				ctx.ui.notify(`review pane failed: ${result.error}`, "error");
			}
		},
	});
}

export default function zvReviewExtension(pi: ExtensionAPI) {
	registerReviewCommand(
		pi,
		"zrv",
		"right",
		"Open a new right pane and start a fresh pi code review session",
		"Opened a review pane to the right",
	);
	registerReviewCommand(
		pi,
		"zrh",
		"down",
		"Open a new lower pane and start a fresh pi code review session",
		"Opened a review pane below",
	);
}

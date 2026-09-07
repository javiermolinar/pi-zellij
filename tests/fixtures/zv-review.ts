import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	loadSkillsFromDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import zvReviewExtension from "../../extensions/zv-review.ts";

async function validateReview() {
	const root = getAgentDir();
	const cwd = join(root, "project with 'quotes'");
	const globalSettings = join(root, "settings.json");
	const projectSettings = join(cwd, CONFIG_DIR_NAME, "settings.json");
	const bin = join(root, "bin");
	mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "pi"), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n`, { mode: 0o755 });
	rmSync(globalSettings, { force: true });

	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const calls: Array<{ command: string; args: string[] }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	let skills: Skill[] = [];
	let trusted = true;
	let execFails = false;
	const pi = {
		registerCommand(name: string, definition: Parameters<ExtensionAPI["registerCommand"]>[1]) {
			commands.set(name, definition);
		},
		async exec(command: string, args: string[]) {
			calls.push({ command, args });
			return execFails
				? { code: 1, stdout: "", stderr: "zellij failed", killed: false }
				: { code: 0, stdout: "81\n", stderr: "", killed: false };
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		isProjectTrusted: () => trusted,
		getSystemPromptOptions: () => ({ skills }),
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	} as unknown as ExtensionCommandContext;
	zvReviewExtension(pi);
	assert.deepEqual([...commands.keys()], ["zrv", "zrh"]);
	assert.equal(calls.length, 0, "registering review commands must not open panes");

	function setSkill(settingsPath: string, skill: unknown) {
		writeFileSync(settingsPath, JSON.stringify({ "pi-zellij": { review: { skill } } }));
	}

	async function invoke(name: string, args: string) {
		calls.length = 0;
		notifications.length = 0;
		await commands.get(name)!.handler(args, ctx);
	}

	async function launch(name = "zrv", args = ""): Promise<string> {
		await invoke(name, args);
		assert.equal(calls.length, 1, JSON.stringify(notifications));
		const call = calls[0]!;
		assert.equal(call.command, "zellij");
		assert.deepEqual(call.args.slice(0, -1), ["run", "--direction", name === "zrv" ? "right" : "down", "--", "sh", "-lc"]);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]!.level, "info");
		assert.match(notifications[0]!.message, /terminal_81/);

		// Execute only the generated shell wrapper with a fake pi that captures argv.
		// This checks quoting without starting Pi, a model turn, or a real pane.
		const result = spawnSync("sh", ["-c", call.args.at(-1)!], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
			timeout: 5000,
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
		const captured = JSON.parse(result.stdout);
		assert.equal(captured.cwd, realpathSync(cwd));
		assert.equal(captured.args.length, 2, "launch must pass one prompt to a fresh Pi session");
		assert.equal(captured.args[0], "--");
		assert.match(captured.args[1], /Do not edit files unless asked\./);
		return captured.args[1];
	}

	async function expectError(args: string, pattern: RegExp, level = "error", name = "zrv") {
		await invoke(name, args);
		assert.equal(calls.length, 0, "errors must be reported before opening a pane");
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]!.level, level);
		assert.match(notifications[0]!.message, pattern);
	}

	const template = readFileSync(new URL("../../extensions/templates/review.md", import.meta.url), "utf8").trim();
	for (const [name, args, expected] of [
		["zrv", "", /Review the current git diff in this repository\./],
		["zrh", "   ", /Review the current git diff in this repository\./],
		["zrv", "src/auth.ts", /Review src\/auth.ts from the current project\./],
		["zrv", "--bugs src/auth.ts", /Focus on correctness issues, runtime failures/],
		["zrh", "--refactor src/", /Focus on simplifications, structure, naming/],
		["zrv", "--tests src/", /Focus on missing coverage, brittle assertions/],
		["zrh", "--diff token refresh and retries", /Extra focus: token refresh and retries\./],
		["zrv", "https://github.com/owner/repo/pull/123", /gh pr view https:\/\/github.com\/owner\/repo\/pull\/123/],
		["zrh", "--diff https://github.com/owner/repo/pull/123?tab=files#diff", /gh pr diff https:\/\/github.com\/owner\/repo\/pull\/123\?tab=files#diff/],
	] as const) {
		const prompt = await launch(name, args);
		assert.ok(prompt.startsWith(`${template}\n\n`), "default review must include the full internal template");
		assert.match(prompt, expected);
		assert.doesNotMatch(prompt, /bundled.*skill|<skill /);
	}
	for (const [args, pattern] of [
		["--unknown", /Unknown review flag/],
		["--bugs", /Specify a file or directory/],
		["--bugs --tests src/", /Use only one review mode flag/],
	] as const) {
		await expectError(args, pattern, "warning");
	}

	function createSkill(name: string, body: string): Skill {
		const dir = join(root, "external-skills", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Custom review instructions\ndisable-model-invocation: true\n---\n${body}\n`);
		const loaded = loadSkillsFromDir({ dir, source: "test" });
		assert.equal(loaded.skills.length, 1, JSON.stringify(loaded.diagnostics));
		return loaded.skills[0]!;
	}

	const globalSkill = createSkill("my-code-review", "Return JSON findings only. Read ./references/rules.md first.");
	const projectSkill = createSkill("project-review", "Return a project-specific review table.");
	skills = [globalSkill, projectSkill];
	setSkill(globalSettings, "  my-code-review  ");
	let prompt = await launch("zrv", "--bugs src/auth.ts");
	assert.ok(prompt.startsWith(`<skill name="my-code-review" location="${globalSkill.filePath}">`));
	assert.ok(prompt.includes(`References are relative to ${globalSkill.baseDir}.`));
	assert.match(prompt, /Return JSON findings only\. Read \.\/references\/rules.md first\./);
	assert.match(prompt, /Focus on correctness issues, runtime failures/);
	assert.doesNotMatch(prompt, /description:|disable-model-invocation:|## Output format|Summary|Test gaps/);
	assert.ok(!prompt.startsWith("/skill:"), "carry the skill body rather than rely on child discovery");

	setSkill(projectSettings, "project-review");
	prompt = await launch("zrh", "--tests https://github.com/owner/repo/pull/42");
	assert.match(prompt, /<skill name="project-review"/);
	assert.match(prompt, /Return a project-specific review table\./);
	assert.match(prompt, /Focus on missing coverage, brittle assertions/);
	assert.match(prompt, /gh pr diff https:\/\/github.com\/owner\/repo\/pull\/42/);
	assert.doesNotMatch(prompt, /Return JSON findings/);

	setSkill(projectSettings, undefined);
	assert.match(await launch(), /<skill name="my-code-review"/);
	setSkill(projectSettings, null);
	assert.ok((await launch()).startsWith(template), "project null must reset a global skill override");
	rmSync(projectSettings);
	setSkill(globalSettings, null);
	assert.ok((await launch()).startsWith(template));

	setSkill(globalSettings, "missing-review");
	await expectError("", /Review skill "missing-review" is not available.*\/reload/);
	setSkill(globalSettings, "my-code-review");
	skills = [];
	await expectError("", /Review skill "my-code-review" is not available/, "error", "zrh");
	skills = [globalSkill, projectSkill];
	rmSync(globalSkill.filePath);
	await expectError("", /Cannot load review skill "my-code-review"/);
	createSkill("my-code-review", "");
	await expectError("", /Skill instructions are empty/);
	createSkill("my-code-review", "Return JSON findings only.");

	for (const value of [true, false, 42, "", "   ", [], {}]) {
		setSkill(projectSettings, value);
		await expectError("", /pi-zellij.review.skill must be a non-empty skill name or null/);
	}
	for (const value of [null, [], 42, { "pi-zellij": false }, { "pi-zellij": { review: "my-code-review" } }]) {
		writeFileSync(projectSettings, JSON.stringify(value));
		await expectError("", /Expected a settings object|pi-zellij(?:.review)? must be an object/);
	}
	writeFileSync(projectSettings, "{ broken json");
	await expectError("", /Failed to read settings from/);
	trusted = false;
	assert.match(await launch(), /<skill name="my-code-review"/, "untrusted project settings must be ignored");
	rmSync(globalSettings);
	assert.ok((await launch()).startsWith(template));
	trusted = true;
	rmSync(projectSettings);
	writeFileSync(globalSettings, "{ broken json");
	await expectError("", /Failed to read settings from/);
	rmSync(globalSettings);

	const sentinel = join(root, "shell-injection");
	const target = `src/O'Reilly.ts; $(touch ${sentinel})`;
	assert.ok((await launch("zrv", target)).includes(target));
	createSkill("my-code-review", `Do not run this literal text: \`touch ${sentinel}\`. Return JSON.`);
	setSkill(globalSettings, "my-code-review");
	assert.ok((await launch("zrh", target)).includes(target));
	assert.equal(existsSync(sentinel), false, "scope and skill text must remain literal shell arguments");

	execFails = true;
	await invoke("zrv", "");
	assert.equal(calls.length, 1);
	assert.equal(notifications[0]!.level, "error");
	assert.match(notifications[0]!.message, /zellij failed/);

	console.log("review split validation passed");
}

export default async function reviewValidation() {
	const root = mkdtempSync(join(tmpdir(), "pi-zellij-review-fixture-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = root;
		await validateReview();
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
	}
}

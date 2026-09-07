import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/zv-review.ts", import.meta.url));
const successMarker = "review split validation passed";

function assertSuccess(result) {
	assert.ifError(result.error);
	assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
}

test("review splits use built-in instructions or a validated skill override", () => {
	const home = mkdtempSync(join(tmpdir(), "pi-zellij-review-test-"));
	try {
		const result = spawnSync(
			process.env.PI_TEST_BIN || "pi",
			["--no-extensions", "--extension", fixturePath, "--help"],
			{
				cwd: home,
				encoding: "utf8",
				env: {
					...process.env,
					HOME: home,
					PI_CODING_AGENT_DIR: join(home, "agent"),
					PI_OFFLINE: "1",
					PI_SKIP_VERSION_CHECK: "1",
					ZELLIJ: "1",
					ZELLIJ_SESSION_NAME: "pi-zellij-test",
					ZELLIJ_PANE_ID: "1",
				},
				timeout: 30_000,
			},
		);
		assertSuccess(result);
		assert.match(result.stdout, new RegExp(successMarker), result.stderr);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("package and installer ship review instructions without a discoverable skill", () => {
	const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	assert.equal(manifest.pi.skills, undefined);
	assert.ok(!manifest.files.includes("skills/"));
	assert.equal(existsSync(join(repoRoot, "skills")), false);
	for (const name of ["review", "review-diff"]) {
		assert.doesNotMatch(readFileSync(join(repoRoot, "prompts", `${name}.md`), "utf8"), /code-review|\/skill:/);
	}

	const home = mkdtempSync(join(tmpdir(), "pi-zellij-install-test-"));
	try {
		const installed = join(home, ".pi", "agent", "packages", "pi-zellij");
		const obsoleteSkill = join(installed, "skills", "code-review", "SKILL.md");
		for (const upgrade of [false, true]) {
			if (upgrade) {
				mkdirSync(join(installed, "skills", "code-review"), { recursive: true });
				writeFileSync(obsoleteSkill, "Old bundled skill");
			}
			assertSuccess(spawnSync(process.execPath, [join(repoRoot, "install.mjs")], {
				cwd: home,
				encoding: "utf8",
				env: { ...process.env, HOME: home },
				timeout: 30_000,
			}));
			assert.equal(existsSync(join(installed, "skills")), false);
			assert.equal(
				readFileSync(join(installed, "extensions", "templates", "review.md"), "utf8"),
				readFileSync(join(repoRoot, "extensions", "templates", "review.md"), "utf8"),
			);
			assert.deepEqual(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")), manifest);
			const settings = JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"));
			assert.deepEqual(settings.packages, ["./packages/pi-zellij"]);
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

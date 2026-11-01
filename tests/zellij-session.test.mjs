import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./fixtures/zellij-session.ts", import.meta.url));

for (const sessionEnv of [
	{},
	{ ZELLIJ: "", ZELLIJ_SESSION_NAME: "", ZELLIJ_PANE_ID: "" },
	{ ZELLIJ: "1" },
	{ ZELLIJ_SESSION_NAME: "pi-zellij-test" },
	{ ZELLIJ_PANE_ID: "0" },
]) {
	const enabled = Object.values(sessionEnv).some(Boolean);
	test(`extension registration ${enabled ? "enabled" : "disabled"} for ${JSON.stringify(sessionEnv)}`, () => {
		const home = mkdtempSync(join(tmpdir(), "pi-zellij-session-test-"));
		try {
			const env = { ...process.env };
			for (const name of ["ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"]) delete env[name];
			const result = spawnSync(
				process.env.PI_TEST_BIN || "pi",
				["--no-extensions", "--extension", fixturePath, "--help"],
				{
					cwd: home,
					encoding: "utf8",
					env: {
						...env,
						...sessionEnv,
						HOME: home,
						PI_CODING_AGENT_DIR: join(home, "agent"),
						PI_OFFLINE: "1",
						PI_SKIP_VERSION_CHECK: "1",
						EXPECT_ZELLIJ_ENABLED: enabled ? "1" : "0",
					},
					timeout: 30_000,
				},
			);
			assert.ifError(result.error);
			const diagnostics = `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
			assert.equal(result.status, 0, diagnostics);
			assert.match(result.stdout, /zellij session registration validation passed/, diagnostics);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
}

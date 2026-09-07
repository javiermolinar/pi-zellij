import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/zv-split-empty-conversation.ts", import.meta.url));
const successMarker = "zellij_start_pi empty-conversation validation passed";

test("zellij_start_pi handles empty conversations without creating clones", () => {
	const result = spawnSync(
		process.env.PI_TEST_BIN || "pi",
		["--no-extensions", "--extension", fixturePath, "--help"],
		{
			cwd: repoRoot,
			encoding: "utf8",
			env: {
				...process.env,
				PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1",
				ZELLIJ: "1",
				ZELLIJ_SESSION_NAME: "pi-zellij-test",
				ZELLIJ_PANE_ID: "1",
			},
			timeout: 30_000,
		},
	);

	assert.ifError(result.error);
	const diagnostics = [`stdout:\n${result.stdout}`, `stderr:\n${result.stderr}`].join("\n\n");
	assert.equal(result.status, 0, diagnostics);
	assert.match(result.stdout, new RegExp(successMarker), diagnostics);
});

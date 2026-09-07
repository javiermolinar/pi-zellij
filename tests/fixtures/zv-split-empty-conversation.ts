import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import zvSplitExtension from "../../extensions/zv-split.ts";

export const EMPTY_CONVERSATION_TEST_MARKER = "zellij_start_pi empty-conversation validation passed";

function createAssistantToolCallMessage() {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "empty-conversation-tool-call",
				name: "zellij_start_pi",
				arguments: { continueSession: true },
			},
		],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	} as any;
}

export default async function emptyConversationValidation() {
	let startPiTool: any;
	const zellijCalls: Array<{ command: string; args: string[] }> = [];
	const fakePi = {
		registerCommand() {},
		registerTool(definition: any) {
			if (definition.name === "zellij_start_pi") startPiTool = definition;
		},
		async exec(command: string, args: string[]) {
			zellijCalls.push({ command, args });
			return { code: 0, stdout: "81\n", stderr: "", killed: false };
		},
	} as any;
	zvSplitExtension(fakePi);
	assert.ok(startPiTool, "zellij_start_pi was not registered");

	const root = mkdtempSync(join(tmpdir(), "pi-zellij-empty-conversation-"));
	try {
		const cwd = join(root, "project");
		mkdirSync(cwd);

		const emptySessionDir = join(root, "empty-sessions");
		const emptySession = SessionManager.create(cwd, emptySessionDir);
		const emptyContext = { cwd, sessionManager: emptySession } as any;

		const freshResult = await startPiTool.execute(
			"fresh-empty",
			{ placement: "right", prompt: "Start fresh" },
			undefined,
			undefined,
			emptyContext,
		);
		assert.equal(freshResult.details.history, "fresh");
		assert.equal(zellijCalls.length, 1, "fresh launch should open one pane");
		assert.deepEqual(readdirSync(emptySessionDir), [], "fresh launch should not clone the empty source session");

		await assert.rejects(
			() =>
				startPiTool.execute(
					"inherit-empty",
					{ placement: "right", continueSession: true },
					undefined,
					undefined,
					emptyContext,
				),
			/The current session has no conversation history to inherit/,
		);
		assert.equal(zellijCalls.length, 1, "empty history must be rejected before opening another pane");
		assert.deepEqual(readdirSync(emptySessionDir), [], "empty history rejection must not create a clone");

		const metadataSessionDir = join(root, "metadata-sessions");
		const metadataOnlySession = SessionManager.create(cwd, metadataSessionDir);
		metadataOnlySession.appendSessionInfo("Metadata only");
		metadataOnlySession.appendMessage(createAssistantToolCallMessage());
		const sourceFiles = readdirSync(metadataSessionDir);
		assert.equal(sourceFiles.length, 1, "the metadata-only source session should be persisted");

		await assert.rejects(
			() =>
				startPiTool.execute(
					"inherit-metadata-only",
					{ placement: "right", continueSession: true },
					undefined,
					undefined,
					{ cwd, sessionManager: metadataOnlySession } as any,
				),
			/The current session has no conversation history to inherit/,
		);
		assert.equal(zellijCalls.length, 1, "metadata-only history must be rejected before opening another pane");
		assert.deepEqual(
			readdirSync(metadataSessionDir),
			sourceFiles,
			"metadata-only history rejection must not create an orphaned clone",
		);

		console.log(EMPTY_CONVERSATION_TEST_MARKER);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

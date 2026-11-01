import assert from "node:assert/strict";
import piZellijExtensionBundle from "../../extensions/index.ts";

export default function zellijSessionValidation() {
	const commands: string[] = [];
	const tools: string[] = [];
	const events: string[] = [];
	const fakePi = {
		registerCommand(name: string) { commands.push(name); },
		registerTool(definition: { name: string }) { tools.push(definition.name); },
		on(name: string) { events.push(name); },
	} as any;

	piZellijExtensionBundle(fakePi);

	if (process.env.EXPECT_ZELLIJ_ENABLED === "1") {
		assert.deepEqual(commands.sort(), ["zv", "zj", "zt", "zz", "zzh", "zrv", "zrh", "zcv", "zch", "zo", "zoh"].sort());
		assert.deepEqual(tools.sort(), ["zellij_start_pi", "zellij_open_terminal"].sort());
		assert.ok(events.includes("session_start"), "pane highlight hooks should be registered");
	} else {
		assert.deepEqual(commands, []);
		assert.deepEqual(tools, []);
		assert.deepEqual(events, []);
	}

	console.log("zellij session registration validation passed");
}

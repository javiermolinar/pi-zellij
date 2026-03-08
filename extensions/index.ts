import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import zvSplitExtension from "./zv-split.ts";
import zvZoxideExtension from "./zv-zoxide.ts";
import zvReviewExtension from "./zv-review.ts";
import zvContinueExtension from "./zv-continue.ts";
import zvOpenExtension from "./zv-open.ts";

export default function piZellijExtensionBundle(pi: ExtensionAPI) {
	zvSplitExtension(pi);
	zvZoxideExtension(pi);
	zvReviewExtension(pi);
	zvContinueExtension(pi);
	zvOpenExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isInsideZellijSession } from "./zv-core.ts";
import zvSplitExtension from "./zv-split.ts";
import zvZoxideExtension from "./zv-zoxide.ts";
import zvReviewExtension from "./zv-review.ts";
import zvContinueExtension from "./zv-continue.ts";
import zvOpenExtension from "./zv-open.ts";
import zvHighlightExtension from "./zv-highlight.ts";

export default function piZellijExtensionBundle(pi: ExtensionAPI) {
	if (!isInsideZellijSession()) return;

	zvSplitExtension(pi);
	zvZoxideExtension(pi);
	zvReviewExtension(pi);
	zvContinueExtension(pi);
	zvOpenExtension(pi);
	zvHighlightExtension(pi);
}

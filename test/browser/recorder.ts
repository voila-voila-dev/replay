// The recorder as a site loads it, for the browser tests: evaluated in the site's own realm.
import { canvas, cssom, iframes, shadow } from "../../src/modules/index";
import { type Options, record } from "../../src/record/index";

(window as unknown as { ReplayRecorder: unknown }).ReplayRecorder = {
	start: (w: Window, o: Options & { all?: boolean }) =>
		record(w, { ...o, modules: o.all ? [shadow(), iframes(), canvas(), cssom()] : [shadow(), iframes(), cssom()] }),
};

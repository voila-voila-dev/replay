// One way to drive each browser the suites run in. A driver opens a URL, evaluates an async
// function of one JSON argument in the page, and types, clicks and selects inside the site frame.
//   chromium, webkit, firefox    Playwright's own builds, desktop
//   android                      Chrome in the Android emulator, over CDP through adb
//   firefox-esr                  a stock Firefox (REPLAY_FIREFOX=path), through geckodriver
//   ios-webdriver                Safari in the iOS Simulator through safaridriver (needs Remote
//                                Automation switched on in the simulator's Safari settings)
// Two targets drive nothing: the page runs the suite itself (`/lab.html?auto`) and posts back.
//   ios                          Safari in a booted iOS Simulator (IOS_UDID, else the booted one)
//   device                       any browser that opens the URL printed (LAB_HOST=0.0.0.0 for
//                                a phone on the same network; hashing then needs localhost or
//                                https, so prefer a tunnel or `adb reverse`)
import { execFileSync, spawn } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TARGETS = ["chromium", "webkit", "firefox", "android", "firefox-esr", "ios-webdriver", "ios", "device"];

export async function open(target, o = {}) {
	if (target === "chromium" || target === "webkit" || target === "firefox") return playwright(target);
	if (target === "android") return android(o);
	if (target === "ios-webdriver") return ios(o);
	if (target === "firefox-esr") return gecko(o);
	if (target === "ios") return simulator(o);
	if (target === "device") return { auto: true, launch: (url) => console.log(`\nouvrir ${url}`), close() {} };
	throw new Error(`unknown target ${target}; one of ${TARGETS.join(", ")}`);
}

/** Safari in the iOS Simulator, opened on the lab's URL; nothing is driven from here. */
function simulator({ udid = process.env.IOS_UDID || "booted" }) {
	const runtime = execFileSync("xcrun", ["simctl", "list", "devices", "booted"], { encoding: "utf8" });
	if (!/Booted/.test(runtime)) throw new Error("no iOS Simulator booted (xcrun simctl boot …)");
	return {
		auto: true,
		// `simctl terminate` can hang for good when Safari is not running: the page is only opened.
		launch: (url) => execFileSync("xcrun", ["simctl", "openurl", udid, url], { timeout: 60_000 }),
		close() {},
	};
}

/** A Playwright page as a driver. */
function fromPage(page, version, close) {
	const site = page.frameLocator("#site");
	return {
		version,
		goto: (url) => page.goto(url),
		evaluate: (fn, arg) => page.evaluate(fn, arg),
		type: (sel, text) => site.locator(sel).pressSequentially(text, { delay: 5 }),
		click: (sel) => site.locator(sel).click(),
		select: (sel, value) => site.locator(sel).selectOption(value),
		close,
	};
}

async function playwright(name) {
	const browser = await { chromium, webkit, firefox }[name].launch();
	const page = await browser.newPage();
	return fromPage(page, `${name} ${browser.version()}`, () => browser.close());
}

const adb = (serial, ...a) => execFileSync("adb", [...(serial ? ["-s", serial] : []), ...a], { encoding: "utf8" }).trim();

/**
 * Chrome on a running emulator or device. The lab's port is reversed to the device, so the page
 * is on localhost there too; Chrome's DevTools socket is forwarded to the Mac.
 */
async function android({ port, serial = process.env.ANDROID_SERIAL, cdp = 9333 }) {
	if (!port) throw new Error("android needs the lab's port");
	adb(serial, "reverse", `tcp:${port}`, `tcp:${port}`);
	// Chrome reads its flags from this file on a debuggable build (an emulator's userdebug image),
	// or once set as the debug app: no first-run screens, the DevTools socket open.
	adb(serial, "shell", "echo '_ --disable-fre --no-default-browser-check --no-first-run --enable-remote-debugging' > /data/local/tmp/chrome-command-line");
	adb(serial, "shell", "am", "set-debug-app", "--persistent", "com.android.chrome");
	adb(serial, "shell", "am", "force-stop", "com.android.chrome");
	adb(serial, "shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main", "-d", "about:blank");
	adb(serial, "forward", `tcp:${cdp}`, "localabstract:chrome_devtools_remote");
	let browser;
	for (let i = 0; i < 30 && !browser; i++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
		} catch (e) {
			if (i === 29) throw e;
			await sleep(1000);
		}
	}
	const context = browser.contexts()[0];
	const page = await context.newPage();
	const model = adb(serial, "shell", "getprop", "ro.product.model");
	const release = adb(serial, "shell", "getprop", "ro.build.version.release");
	return fromPage(page, `Chrome ${browser.version()} · ${model}, Android ${release}`, async () => {
		await page.close().catch(() => {});
		await browser.close().catch(() => {});
	});
}

/** Starts a WebDriver server and waits for it to answer. */
async function server(cmd, args, port) {
	const child = spawn(cmd, args, { stdio: "ignore" });
	for (let i = 0; i < 50; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/status`);
			if (r.ok) return child;
		} catch {}
		await sleep(200);
	}
	child.kill();
	throw new Error(`${cmd} did not start`);
}

const ELEMENT = "element-6066-11e4-a52f-4f735466cecf";

/** A W3C WebDriver session, just what the suites need. */
async function webdriver(base, capabilities, version, child) {
	const call = async (method, path, body) => {
		const r = await fetch(`${base}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const json = await r.json();
		if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`.split("\n")[0]);
		return json.value;
	};
	let made;
	try {
		made = await call("POST", "/session", { capabilities: { alwaysMatch: capabilities } });
	} catch (e) {
		child?.kill();
		throw e;
	}
	const s = `/session/${made.sessionId}`;
	await call("POST", `${s}/timeouts`, { script: 300_000, pageLoad: 60_000 });
	const caps = made.capabilities;
	const find = async (sel) => (await call("POST", `${s}/element`, { using: "css selector", value: sel }))[ELEMENT];
	const inSite = async (fn) => {
		await call("POST", `${s}/frame`, { id: { [ELEMENT]: await find("#site") } });
		try {
			return await fn();
		} finally {
			await call("POST", `${s}/frame/parent`, {});
		}
	};
	return {
		version: version(caps),
		goto: (url) => call("POST", `${s}/url`, { url }),
		async evaluate(fn, arg) {
			const script = `const done = arguments[arguments.length - 1];
Promise.resolve().then(() => (${String(fn)})(arguments[0])).then((v) => done({ ok: v === undefined ? null : v }), (e) => done({ err: String(e && e.stack || e) }));`;
			const r = await call("POST", `${s}/execute/async`, { script, args: [arg === undefined ? null : arg] });
			if (r && "err" in r) throw new Error(r.err);
			return r?.ok;
		},
		// Enter goes as the WebDriver key, as a person presses it.
		type: (sel, text) => inSite(async () => call("POST", `${s}/element/${await find(sel)}/value`, { text: text.replace(/\n/g, "") })),
		click: (sel) => inSite(async () => call("POST", `${s}/element/${await find(sel)}/click`, {})),
		select: (sel, value) => inSite(async () => call("POST", `${s}/element/${await find(`${sel} option[value="${value}"]`)}/click`, {})),
		async close() {
			await call("DELETE", s).catch(() => {});
			child?.kill();
		},
	};
}

/**
 * Safari in a booted iOS Simulator. safaridriver needs `safaridriver --enable` once on the Mac,
 * and Remote Automation on in the simulator's Safari settings.
 */
async function ios({ udid = process.env.IOS_UDID, wdPort = 4444 } = {}) {
	const child = await server("safaridriver", ["-p", String(wdPort)], wdPort);
	const caps = { browserName: "Safari", platformName: "iOS", "safari:useSimulator": true };
	if (udid) caps["safari:deviceUDID"] = udid;
	return webdriver(`http://127.0.0.1:${wdPort}`, caps, (c) => `Safari ${c.browserVersion} · ${c["safari:deviceName"] || "Simulator"}, iOS ${c["safari:platformVersion"] || c.platformVersion || "?"}`, child);
}

/** A stock Firefox, ESR or other, through geckodriver. */
async function gecko({ binary = process.env.REPLAY_FIREFOX, wdPort = 4445 } = {}) {
	if (!binary) throw new Error("firefox-esr needs REPLAY_FIREFOX=/path/to/firefox");
	const child = await server("geckodriver", ["--port", String(wdPort)], wdPort);
	const caps = { browserName: "firefox", "moz:firefoxOptions": { binary, args: process.env.HEADED ? [] : ["-headless"] } };
	const d = await webdriver(`http://127.0.0.1:${wdPort}`, caps, (c) => `Firefox ${c.browserVersion}`, child);
	// geckodriver only opens the page, which runs the suite itself: switching into the site frame
	// by element reference fails with older Firefox builds.
	return { auto: true, version: d.version, launch: (url) => void d.goto(url).catch(() => {}), close: d.close };
}

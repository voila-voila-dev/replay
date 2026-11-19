export { CASES, type Case } from "./cases";
export { compare, type Diff, type OracleOptions } from "./oracle";

/** The secrets found in what left the page, in clear: each one is a leak. */
export function leaks(sent: ReadonlyArray<string>, secrets: ReadonlyArray<string>): Array<string> {
	return secrets.filter((s) => sent.some((body) => body.includes(s)));
}
export { FUZZ_PAGE, mutator, seeded } from "./fuzz";

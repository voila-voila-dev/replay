import { describe, expect, test } from "bun:test";
import { Op, resolve } from "../../src/format/index";
import { type Answer, connect, type Envelope, pack } from "../../src/send/index";

const head = { url: "https://exemple.test/", pv: "pv1", property: "p" };
const piece = (tape: Array<number | string | null>, base = 1, cuts?: Array<number>) => ({ tape, base, startedAt: 1, endedAt: 2, cuts });
const long = "x".repeat(300);

function server(answers: Array<Answer | undefined> = []) {
	const bodies: Array<Envelope> = [];
	const post = async (_: string, body: string) => {
		bodies.push(JSON.parse(body));
		return answers.shift();
	};
	return { bodies, post };
}

test("pack and resolve give the tape back, pieces and long strings by hash", async () => {
	const tape = [Op.META, 2, "u", 0, 1, 1, 0, Op.E, "style", 0, Op.T, long, Op.X, Op.E, "p", 0, Op.X];
	const kept = new Map<string, string>();
	const wire = await pack(tape, [7, 13], kept);
	expect(wire.filter(Array.isArray).length).toBe(2);
	expect(resolve(wire, (h) => kept.get(h))).toEqual(tape);
});

describe("connect", () => {
	test("numbers chunks from 0 and sends what the server asks for", async () => {
		const s = server();
		const link = connect({ endpoint: "/r", head: () => head, post: s.post });
		const kept = new Map<string, string>();
		await pack([Op.T, long], undefined, kept);
		const [h] = [...kept.keys()];
		const ss = server([{ need: [h as string] }]);
		const l2 = connect({ endpoint: "/r", head: () => head, post: ss.post });
		await l2.send(piece([Op.TICK, 1, Op.T, long]));
		expect(ss.bodies[0]?.seq).toBe(0);
		expect(ss.bodies[1]?.blobs?.[h as string]).toBe(long);
		await link.send(piece([Op.TICK, 1]));
		await link.send(piece([Op.TICK, 2]));
		expect(s.bodies.map((b) => b.seq)).toEqual([0, 1]);
	});
	test("asks for a snapshot when the server saw a hole", async () => {
		const s = server([{ snap: true }]);
		let snaps = 0;
		await connect({ endpoint: "/r", head: () => head, post: s.post, onSnap: () => snaps++ }).send(piece([Op.TICK, 1]));
		expect(snaps).toBe(1);
	});
	test("holds chunks until the page view has an id", async () => {
		const s = server();
		let h: typeof head | undefined;
		const link = connect({ endpoint: "/r", head: () => h, post: s.post });
		await link.send(piece([Op.TICK, 1]));
		expect(s.bodies.length).toBe(0);
		h = head;
		await link.send(piece([Op.TICK, 2]));
		expect(s.bodies.map((b) => b.tape)).toEqual([[Op.TICK, 1], [Op.TICK, 2]]);
	});
	test("gives up after three retries and says so", async () => {
		let failed = 0;
		const link = connect({
			endpoint: "/r",
			head: () => head,
			post: async () => {
				throw new Error("offline");
			},
			wait: async () => {},
			onFail: () => failed++,
		});
		await link.send(piece([Op.TICK, 1]));
		expect(link.failed).toBe(true);
		expect(failed).toBe(1);
	});
	test("the beacon takes what is queued, under its first number, within 60 KB", async () => {
		const beacons: Array<Envelope> = [];
		let release: () => void = () => {};
		const slow = new Promise<void>((r) => {
			release = r;
		});
		const s = server();
		const link = connect({
			endpoint: "/r",
			head: () => head,
			post: async (u, b) => {
				await slow;
				return s.post(u, b);
			},
			beacon: (_, body) => {
				beacons.push(JSON.parse(body));
				return true;
			},
		});
		void link.send(piece([Op.TICK, 1]));
		// The first one is on its way, the second waits behind it.
		await new Promise((r) => setTimeout(r, 0));
		void link.send(piece([Op.TICK, 2], 1));
		link.leave(piece([Op.TICK, 3], 1));
		release();
		await link.idle();
		expect(beacons.length).toBe(1);
		expect(beacons[0]?.last).toBe(true);
		expect(beacons[0]?.seq).toBe(1);
		expect(beacons[0]?.tape).toEqual([Op.TICK, 2, Op.TICK, 3]);
		// The one in flight went out; the one the beacon took did not go twice.
		expect(s.bodies.map((b) => b.seq)).toEqual([0]);
	});
	test("a beacon too large drops the tape rather than breaking the limit", () => {
		const beacons: Array<string> = [];
		const link = connect({ endpoint: "/r", head: () => head, post: async () => undefined, beacon: (_, b) => (beacons.push(b), true) });
		link.leave(piece([Op.T, "y".repeat(70_000)]));
		expect(beacons.length).toBe(0);
	});
});

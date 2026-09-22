import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveGate, type SaveGateOptions } from "./saveGate";
import type { SaveStatus } from "../types";

/** Lets queued promise chains (in-flight → chained run) settle. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface Harness {
  gate: ReturnType<typeof createSaveGate>;
  save: ReturnType<typeof vi.fn>;
  statuses: SaveStatus[];
}

function harness(overrides: Partial<SaveGateOptions> = {}, saveImpl?: () => Promise<boolean>): Harness {
  const statuses: SaveStatus[] = [];
  const save = vi.fn(saveImpl ?? (async () => true));
  const gate = createSaveGate({
    save: save as unknown as SaveGateOptions["save"],
    onStatus: (s) => statuses.push(s),
    debounceMs: 600,
    initialRetryMs: 1000,
    maxRetryMs: 5000,
    ...overrides,
  });
  return { gate, save, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createSaveGate — debounce", () => {
  it("saves once after the debounce window", async () => {
    const { gate, save, statuses } = harness();
    gate.dirty();
    expect(statuses).toEqual(["saving"]);

    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBe("saved");
    expect(gate.isDirty()).toBe(false);
  });

  it("re-arms on every edit so only the quiet window triggers a save", async () => {
    const { gate, save } = harness();
    gate.dirty();
    await vi.advanceTimersByTimeAsync(300);
    gate.dirty(); // user kept typing
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() saves immediately and clears the pending timer", async () => {
    const { gate, save } = harness();
    gate.dirty();
    const p = gate.flush();
    await settle();
    await p;
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1); // debounce timer was cleared
  });

  it("flush() on a clean gate is a no-op", async () => {
    const { gate, save } = harness();
    await gate.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("createSaveGate — in-flight race (the stranded-edits bug)", () => {
  it("flush() during an in-flight save chains a follow-up with the latest draft and only resolves after it lands", async () => {
    const resolvers: Array<(ok: boolean) => void> = [];
    const { gate, save } = harness({}, () =>
      new Promise<boolean>((r) => resolvers.push(r)),
    );

    gate.dirty();
    const firstFlush = gate.flush(); // save #1 starts, stalls
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    gate.dirty(); // user types more while save #1 is still running
    const secondFlush = gate.flush(); // must NOT be dropped
    await settle();
    expect(save).toHaveBeenCalledTimes(1); // still only one running

    resolvers[0](true);
    await settle();
    expect(save).toHaveBeenCalledTimes(2); // chained run picked up latest edits

    resolvers[1](true);
    await firstFlush;
    await secondFlush;
    expect(gate.isDirty()).toBe(false);
  });

  it("a mid-flight flush whose chained save fails keeps the edits dirty for retry", async () => {
    const resolvers: Array<(ok: boolean) => void> = [];
    const { gate } = harness({}, () => new Promise<boolean>((r) => resolvers.push(r)));

    gate.dirty();
    const p1 = gate.flush();
    await settle();
    gate.dirty();
    const p2 = gate.flush();
    await settle();

    resolvers[0](true);
    await settle();
    resolvers[1](false); // second attempt fails
    await p1;
    await p2;
    expect(gate.isDirty()).toBe(true);
  });
});

describe("createSaveGate — failure retry with backoff", () => {
  it("retries at 1s → 2s → 4s → 5s (cap) and reports 'error' each time", async () => {
    let shouldFail = true;
    const { gate, save, statuses } = harness({}, async () => !shouldFail);

    gate.dirty();
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBe("error");

    // 1st retry after 1s
    await vi.advanceTimersByTimeAsync(999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);

    // 2nd retry after 2s
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(save).toHaveBeenCalledTimes(3);

    // 3rd retry after 4s
    await vi.advanceTimersByTimeAsync(4000);
    await settle();
    expect(save).toHaveBeenCalledTimes(4);

    // 4th retry after 5s (capped)
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(save).toHaveBeenCalledTimes(5);

    // 5th retry still capped at 5s
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(save).toHaveBeenCalledTimes(6);
    expect(statuses[statuses.length - 1]).toBe("error");

    // Recovery: next attempt succeeds → status saved, backoff reset.
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(statuses[statuses.length - 1]).toBe("saved");
    expect(gate.isDirty()).toBe(false);
  });

  it("a successful save resets the backoff to the initial delay", async () => {
    let calls = 0;
    // fail, fail, succeed, fail → the retry after the success waits 1s again
    const { gate, save } = harness({}, async () => {
      calls += 1;
      return calls !== 1 && calls !== 2 && calls !== 4;
    });

    gate.dirty();
    await vi.advanceTimersByTimeAsync(600); // #1 fail
    await settle();
    await vi.advanceTimersByTimeAsync(1000); // #2 fail (1s)
    await settle();
    await vi.advanceTimersByTimeAsync(2000); // #3 succeeds (2s) → reset
    await settle();
    expect(save).toHaveBeenCalledTimes(3);

    gate.dirty(); // new edit → fails
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(save).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(999); // back to 1s delay
    expect(save).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(5);
  });
});

describe("createSaveGate — lifecycle", () => {
  it("reset() drops dirty state and pending timers (editor switched notes)", async () => {
    const { gate, save } = harness();
    gate.dirty();
    gate.reset();
    expect(gate.isDirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
  });

  it("dispose() cancels future saves but never an in-flight one", async () => {
    const resolvers: Array<(ok: boolean) => void> = [];
    const { gate, save } = harness({}, () => new Promise<boolean>((r) => resolvers.push(r)));

    gate.dirty();
    const p = gate.flush(); // in-flight
    await settle();
    gate.dispose();
    resolvers[0](true);
    await p;
    expect(save).toHaveBeenCalledTimes(1); // the running save completed

    gate.dirty(); // edits after dispose can't arm a zombie timer
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("dispose() also stops the retry loop after a failed save", async () => {
    const { gate, save } = harness({}, async () => false);
    gate.dirty();
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    gate.dispose(); // unmount before the 1s retry fires
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

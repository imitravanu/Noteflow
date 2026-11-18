import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

import { requestAppExit } from "./exitFlow";
import { useUiStore } from "../store/uiStore";

beforeEach(() => {
  mocks.destroy.mockReset().mockResolvedValue(undefined);
  mocks.getCurrentWindow.mockReset().mockReturnValue({ destroy: mocks.destroy });
  useUiStore.setState({
    editorNoteId: "n1",
    editorNote: null,
    editorFlush: null,
    page: "notes",
    snackbar: null,
    snackbarQueue: [],
    pendingReminderAck: null,
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("requestAppExit", () => {
  it("waits for the editor's in-flight flush before destroying the window", async () => {
    const flush = deferred<boolean>();
    useUiStore.getState().registerEditorFlush(() => flush.promise);

    const exit = requestAppExit();
    await settle();
    expect(mocks.destroy).not.toHaveBeenCalled();

    flush.resolve(true);
    await exit;
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the process open with a retryable error when the draft cannot be saved", async () => {
    let saved = false;
    useUiStore.getState().registerEditorFlush(() => Promise.resolve(saved));

    const exited = await requestAppExit();
    expect(exited).toBe(false);
    expect(mocks.destroy).not.toHaveBeenCalled();

    const error = useUiStore.getState().snackbar;
    expect(error?.actionLabel).toBe("Retry");
    expect(error?.message).toMatch(/stayed open/i);

    saved = true;
    error?.action?.();
    await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledOnce());
  });

  it("treats a thrown IPC flush as a failed save (no exit)", async () => {
    useUiStore.getState().registerEditorFlush(() => Promise.reject(new Error("disk full")));

    expect(await requestAppExit()).toBe(false);
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(useUiStore.getState().snackbar?.actionLabel).toBe("Retry");
  });
});

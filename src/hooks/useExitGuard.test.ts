import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { requestAppExit } from "../services/exitFlow";
import { useExitGuard } from "./useExitGuard";

vi.mock("react", () => ({ useEffect: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../services/exitFlow", () => ({ requestAppExit: vi.fn() }));

function mountGuard() {
  useExitGuard();
  return vi.mocked(useEffect).mock.calls[0][0]();
}

beforeEach(() => vi.resetAllMocks());

describe("useExitGuard", () => {
  it("skips native window access in a browser", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error("No native window in browser");
    });

    expect(mountGuard()).toBeUndefined();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it("prevents native close before requesting a flushed exit and unlistens on cleanup", async () => {
    const unlisten = vi.fn();
    const onCloseRequested = vi.fn().mockResolvedValue(unlisten);
    vi.mocked(getCurrentWindow).mockReturnValue({
      onCloseRequested,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    vi.mocked(isTauri).mockReturnValue(true);

    const cleanup = mountGuard();
    expect(onCloseRequested).toHaveBeenCalledOnce();
    const preventDefault = vi.fn();
    vi.mocked(requestAppExit).mockImplementation(async () => {
      expect(preventDefault).toHaveBeenCalledOnce();
      return true;
    });
    await onCloseRequested.mock.calls[0][0]({ preventDefault });
    expect(requestAppExit).toHaveBeenCalledOnce();

    cleanup?.();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

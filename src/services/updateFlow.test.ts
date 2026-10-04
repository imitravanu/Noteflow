import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import { useUiStore } from "../store/uiStore";
import { checkManually, checkOnLaunch } from "./updateFlow";

function fakeUpdate(installOk: boolean) {
  return {
    version: "9.9.9",
    body: "Ships the thing.",
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn((onEvent: (e: unknown) => void) => {
      if (!installOk) return Promise.reject(new Error("cannot replace binary"));
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
      onEvent({ event: "Finished" });
      return Promise.resolve();
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.check.mockReset();
  mocks.relaunch.mockReset().mockResolvedValue(undefined);
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  useUiStore.setState({ snackbar: null, snackbarQueue: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("updateFlow", () => {
  it("announces an available update with an Update action", async () => {
    mocks.check.mockResolvedValue(fakeUpdate(true));
    await checkOnLaunch();

    const s = useUiStore.getState().snackbar;
    expect(s?.message).toBe("NoteFlow v9.9.9 is available");
    expect(s?.actionLabel).toBe("Update");
  });

  it("confirmation downloads, installs, and relaunches into the new version", async () => {
    mocks.check.mockResolvedValue(fakeUpdate(true));
    await checkOnLaunch();
    useUiStore.getState().snackbar?.action?.();

    await vi.waitFor(() => {
      expect(useUiStore.getState().snackbar?.message).toBe(
        "NoteFlow v9.9.9 installed — restarting…",
      );
    });
    expect(useUiStore.getState().snackbar?.actionLabel).toBeUndefined();

    await vi.advanceTimersByTimeAsync(900);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("falls back to the release page when auto-install is unavailable (.deb)", async () => {
    mocks.check.mockResolvedValue(fakeUpdate(false));
    await checkOnLaunch();
    useUiStore.getState().snackbar?.action?.();

    await vi.waitFor(() => {
      expect(useUiStore.getState().snackbar?.message).toContain("download v9.9.9 manually");
    });
    const fallback = useUiStore.getState().snackbar;
    expect(fallback?.actionLabel).toBe("Open");

    fallback?.action?.();
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/imitravanu/Noteflow/releases/tag/v9.9.9",
    );
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("manual check reports when already up to date", async () => {
    mocks.check.mockResolvedValue(null);
    await checkManually();

    expect(useUiStore.getState().snackbar?.message).toContain("is up to date");
  });

  it("a failed check is silent on launch and reported for manual checks", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));
    await checkOnLaunch();
    expect(useUiStore.getState().snackbar).toBeNull();

    await checkManually();
    expect(useUiStore.getState().snackbar?.message).toContain("Could not check for updates");
  });
});

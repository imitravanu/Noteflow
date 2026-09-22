import { describe, expect, it } from "vitest";
import { escapeAction, type EscapeState } from "./escape";

const closed: EscapeState = {
  confirmOpen: false,
  shortcutsOpen: false,
  popoverOpen: false,
  editorOpen: false,
  hasSelection: false,
  sidebarOpen: false,
};

const state = (overrides: Partial<EscapeState>): EscapeState => ({
  ...closed,
  ...overrides,
});

describe("escapeAction priority cascade", () => {
  it("does nothing when every layer is closed", () => {
    expect(escapeAction(closed)).toBe("none");
  });

  it("lets the confirm dialog swallow Escape above everything", () => {
    expect(
      escapeAction(
        state({
          confirmOpen: true,
          shortcutsOpen: true,
          popoverOpen: true,
          editorOpen: true,
          hasSelection: true,
          sidebarOpen: true,
        }),
      ),
    ).toBe("none");
  });

  it("closes the shortcuts modal before lower layers", () => {
    expect(escapeAction(state({ shortcutsOpen: true, editorOpen: true }))).toBe(
      "close-shortcuts",
    );
  });

  it("closes an open popover BEFORE the editor (regression: Esc in a color/tag picker must not close the note)", () => {
    expect(
      escapeAction(state({ popoverOpen: true, editorOpen: true, hasSelection: true })),
    ).toBe("close-popover");
    // ...and before a selection too (popover inside the selection bar).
    expect(escapeAction(state({ popoverOpen: true, hasSelection: true }))).toBe(
      "close-popover",
    );
  });

  it("closes the editor before clearing a selection", () => {
    expect(escapeAction(state({ editorOpen: true, hasSelection: true }))).toBe(
      "close-editor",
    );
  });

  it("clears a selection before closing the sidebar", () => {
    expect(escapeAction(state({ hasSelection: true, sidebarOpen: true }))).toBe(
      "clear-selection",
    );
  });

  it("closes the sidebar as the last layer", () => {
    expect(escapeAction(state({ sidebarOpen: true }))).toBe("close-sidebar");
  });

  it("walks the full stack one layer at a time", () => {
    const full = state({
      shortcutsOpen: true,
      popoverOpen: true,
      editorOpen: true,
      hasSelection: true,
      sidebarOpen: true,
    });
    expect(escapeAction(full)).toBe("close-shortcuts");
    expect(escapeAction({ ...full, shortcutsOpen: false })).toBe("close-popover");
    expect(escapeAction({ ...full, shortcutsOpen: false, popoverOpen: false })).toBe(
      "close-editor",
    );
    expect(
      escapeAction({
        ...full,
        shortcutsOpen: false,
        popoverOpen: false,
        editorOpen: false,
      }),
    ).toBe("clear-selection");
    expect(
      escapeAction({
        ...full,
        shortcutsOpen: false,
        popoverOpen: false,
        editorOpen: false,
        hasSelection: false,
      }),
    ).toBe("close-sidebar");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_TABS,
  DEFAULT_LAYOUT,
  DOCUMENT_TABS_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  OPEN_PROJECTS_STORAGE_KEY,
  SYNC_UI_CODE_STORAGE_KEY,
  clamp,
  loadDocumentTabs,
  loadOpenProjects,
  loadSyncUiEditsToCode,
  loadWorkspaceLayout
} from "./workspace-storage";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("workspace storage", () => {
  it("syncs UI edits to code unless explicitly disabled", () => {
    expect(loadSyncUiEditsToCode()).toBe(true);
    store.set(SYNC_UI_CODE_STORAGE_KEY, "0");
    expect(loadSyncUiEditsToCode()).toBe(false);
  });

  it("keeps only valid open projects and caps the list at 8", () => {
    const valid = Array.from({ length: 10 }, (_, index) => ({ root: `/p${index}`, name: `p${index}` }));
    store.set(OPEN_PROJECTS_STORAGE_KEY, JSON.stringify([{ root: 1 }, null, ...valid]));
    const projects = loadOpenProjects();
    expect(projects).toHaveLength(8);
    expect(projects[0]?.root).toBe("/p0");
  });

  it("returns no open projects for broken json", () => {
    store.set(OPEN_PROJECTS_STORAGE_KEY, "{broken");
    expect(loadOpenProjects()).toEqual([]);
  });

  it("filters unknown document tabs and appends missing defaults", () => {
    store.set(DOCUMENT_TABS_STORAGE_KEY, JSON.stringify(["code", "bogus", "visual"]));
    const tabs = loadDocumentTabs();
    expect(tabs.slice(0, 2)).toEqual(["code", "visual"]);
    expect([...tabs].sort()).toEqual([...DEFAULT_DOCUMENT_TABS].sort());
  });

  it("clamps the stored layout into allowed ranges", () => {
    expect(loadWorkspaceLayout()).toEqual(DEFAULT_LAYOUT);
    store.set(LAYOUT_STORAGE_KEY, JSON.stringify({ left: 10, right: 9999, previewDock: 300.4, terminal: 1 }));
    expect(loadWorkspaceLayout()).toEqual({ left: 160, right: 480, previewDock: 300, terminal: 40 });
  });

  it("rounds while clamping", () => {
    expect(clamp(5.6, 0, 10)).toBe(6);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});

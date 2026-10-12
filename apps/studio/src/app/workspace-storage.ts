import type { RecentProject, WorkspaceLayout, DocumentTab } from "./types";

export const OPEN_PROJECTS_STORAGE_KEY = "tapmakerwork.openProjects";
export const SYNC_UI_CODE_STORAGE_KEY = "tapmakerwork.syncUiEditsToCode";

export function loadSyncUiEditsToCode(): boolean {
  try {
    return localStorage.getItem(SYNC_UI_CODE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function loadOpenProjects(): RecentProject[] {
  try {
    const stored = JSON.parse(localStorage.getItem(OPEN_PROJECTS_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(stored)
      ? stored.filter((item): item is RecentProject => Boolean(item && typeof item.root === "string" && typeof item.name === "string")).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export const DEFAULT_LAYOUT = {
  left: 220,
  right: 280,
  previewDock: 300,
  terminal: 120
};

export const LAYOUT_STORAGE_KEY = "tapmakerwork.workspaceLayout";
export const DOCUMENT_TABS_STORAGE_KEY = "tapmakerwork.documentTabs";
export const DEFAULT_DOCUMENT_TABS: DocumentTab[] = ["workflow", "visual", "runtime", "code", "preview"];

export function loadDocumentTabs(): DocumentTab[] {
  try {
    const value = JSON.parse(localStorage.getItem(DOCUMENT_TABS_STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(value)) return [...DEFAULT_DOCUMENT_TABS];
    const valid = value.filter((item): item is DocumentTab => DEFAULT_DOCUMENT_TABS.includes(item as DocumentTab));
    return [...new Set([...valid, ...DEFAULT_DOCUMENT_TABS])];
  } catch {
    return [...DEFAULT_DOCUMENT_TABS];
  }
}

export function loadWorkspaceLayout(): WorkspaceLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayout>;
    return {
      left: clamp(parsed.left ?? DEFAULT_LAYOUT.left, 160, 420),
      right: clamp(parsed.right ?? DEFAULT_LAYOUT.right, 200, 480),
      previewDock: clamp(parsed.previewDock ?? DEFAULT_LAYOUT.previewDock, 220, 520),
      terminal: clamp(parsed.terminal ?? DEFAULT_LAYOUT.terminal, 40, terminalMaxHeight())
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function terminalMaxHeight(): number {
  return Math.max(120, (typeof window === "undefined" ? 800 : window.innerHeight) - 48 - 40 - 22 - 96);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

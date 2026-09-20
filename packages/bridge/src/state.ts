import { applyUiPatch, applyUiTreeOp, type UiPatch, type UiSnapshot, type UiTreeOp } from "@tapmakerwork/protocol";

export function initialUiSnapshot(): UiSnapshot {
  return {
    revision: 1,
    selectedId: "home.single-player",
    root: {
      id: "home.root",
      type: "Panel",
      name: "HomePage",
      props: {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        paddingTop: 72,
        paddingBottom: 32,
        backgroundColor: [21, 29, 48, 255]
      },
      source: { file: "scripts/ui/HomePage.lua", line: 146 },
      children: [
        {
          id: "home.title",
          type: "Label",
          name: "Title",
          props: { text: "乱世夺城", width: 390, height: 48, fontSize: 40, fontColor: [255, 236, 180, 255] },
          source: { file: "scripts/ui/HomePage.lua", line: 162 },
          children: []
        },
        {
          id: "home.actions",
          type: "Panel",
          name: "Actions",
          props: { width: 380, gap: 12, alignSelf: "center" },
          source: { file: "scripts/ui/HomePage.lua", line: 204 },
          children: [
            {
              id: "home.single-player",
              type: "Button",
              name: "SinglePlayerButton",
              props: {
                text: "单机争伐",
                width: "100%",
                height: 52,
                borderRadius: 10,
                backgroundColor: [66, 116, 201, 255]
              },
              source: { file: "scripts/ui/HomePage.lua", line: 62 },
              children: []
            },
            {
              id: "home.online",
              type: "Button",
              name: "OnlineButton",
              props: {
                text: "出征九州（消耗1灵玉）",
                width: "100%",
                height: 52,
                borderRadius: 10,
                backgroundColor: [52, 72, 110, 255]
              },
              source: { file: "scripts/ui/HomePage.lua", line: 70 },
              children: []
            }
          ]
        }
      ]
    }
  };
}

export class EditorState {
  private snapshot: UiSnapshot;
  private undoStack: UiSnapshot[] = [];
  private redoStack: UiSnapshot[] = [];
  private activeHistoryGroup: string | undefined;

  constructor(snapshot: UiSnapshot = initialUiSnapshot()) {
    this.snapshot = snapshot;
  }

  getSnapshot(): UiSnapshot {
    return this.snapshot;
  }

  reset(snapshot: UiSnapshot): UiSnapshot {
    this.snapshot = { ...snapshot, revision: this.snapshot.revision + 1 };
    this.undoStack = [];
    this.redoStack = [];
    this.activeHistoryGroup = undefined;
    return this.snapshot;
  }

  replaceFromRuntime(snapshot: UiSnapshot): UiSnapshot {
    this.snapshot = {
      ...snapshot,
      revision: this.snapshot.revision + 1,
      ...(snapshot.selectedId || !this.snapshot.selectedId ? {} : { selectedId: this.snapshot.selectedId })
    };
    return this.snapshot;
  }

  apply(patch: UiPatch): UiSnapshot {
    if (!patch.historyGroup || patch.historyGroup !== this.activeHistoryGroup) {
      this.undoStack.push(this.snapshot);
      this.redoStack = [];
    }
    this.activeHistoryGroup = patch.historyGroup;
    this.snapshot = applyUiPatch(this.snapshot, patch);
    return this.snapshot;
  }

  applyTreeOp(op: UiTreeOp): UiSnapshot {
    this.undoStack.push(this.snapshot);
    this.redoStack = [];
    this.activeHistoryGroup = undefined;
    this.snapshot = applyUiTreeOp(this.snapshot, op);
    return this.snapshot;
  }

  undo(): UiSnapshot {
    this.activeHistoryGroup = undefined;
    const previous = this.undoStack.pop();
    if (!previous) return this.snapshot;
    this.redoStack.push(this.snapshot);
    this.snapshot = { ...previous, revision: this.snapshot.revision + 1 };
    return this.snapshot;
  }

  redo(): UiSnapshot {
    this.activeHistoryGroup = undefined;
    const next = this.redoStack.pop();
    if (!next) return this.snapshot;
    this.undoStack.push(this.snapshot);
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    return this.snapshot;
  }
}

import { describe, expect, it } from "vitest";
import { analyzeTracks, buildHeatBoard, buildRisingBoard, buildScoreBuckets, computeRisingScore, mapTrack, normalizeMakerApp } from "./new-game-radar.js";

describe("new-game-radar", () => {
  it("maps tags into tracks", () => {
    expect(mapTrack(["模拟", "经营"], "农场日记")).toBe("模拟经营/建造");
    expect(mapTrack(["动作"], "割草小骑士")).toBe("动作/格斗");
    expect(mapTrack(["音游"], "节奏大师")).toBe("音游/节奏");
  });

  it("normalizes maker app payload", () => {
    const entry = normalizeMakerApp(
      {
        id: 1,
        title: "测试游戏",
        developers: [{ id: 99, name: "作者甲", website: "" }],
        icon: { small_url: "https://img.example/icon.png" },
        tags: [{ value: "TapTap制造" }, { value: "策略" }],
        title_labels: ["测试"],
        released_time: 1700000000,
        stat: {
          hits_total: 120,
          review_count: 3,
          fans_count: 40,
          rating: { score: "8.6" }
        }
      },
      "制造热度 Top1-10",
      1
    );
    expect(entry.title).toBe("测试游戏");
    expect(entry.author).toBe("作者甲");
    expect(entry.authorId).toBe(99);
    expect(entry.authorUrl).toBe("https://www.taptap.cn/developer/99");
    expect(entry.iconUrl).toBe("https://img.example/icon.png");
    expect(entry.url).toBe("https://www.taptap.cn/app/1");
    expect(entry.tags).toEqual(["策略"]);
    expect(entry.score).toBe(8.6);
    expect(entry.hits).toBe(120);
    expect(entry.rank).toBe(1);
  });

  it("computes opportunity higher for sparse low-head tracks", () => {
    const rows = analyzeTracks([
      { id: 1, title: "A", author: "a", tags: ["模拟"], score: 8.5, hits: 900, reviewCount: 10, fans: 100, board: "b", rank: 1, labels: [] },
      { id: 2, title: "B", author: "b", tags: ["模拟"], score: 8.4, hits: 80, reviewCount: 2, fans: 20, board: "b", rank: 2, labels: [] },
      { id: 3, title: "C", author: "c", tags: ["模拟"], score: 8.2, hits: 70, reviewCount: 1, fans: 10, board: "b", rank: 3, labels: [] },
      { id: 4, title: "D", author: "d", tags: ["模拟"], score: 8.1, hits: 60, reviewCount: 1, fans: 10, board: "b", rank: 4, labels: [] },
      { id: 9, title: "X", author: "x", tags: ["动作"], score: 8.8, hits: 40, reviewCount: 2, fans: 10, board: "b", rank: 1, labels: [] }
    ]);
    const crowdedRow = rows.find((row) => row.track === "模拟经营/建造");
    const blueRow = rows.find((row) => row.track === "动作/格斗");
    expect(crowdedRow?.quadrant).toBe("巨头垄断");
    expect(blueRow?.quadrant).toBe("蓝海空白");
    expect((blueRow?.opportunity || 0) > (crowdedRow?.opportunity || 0)).toBe(true);
  });

  it("builds heat and rising boards from口碑与热度", () => {
    const pool = [
      { id: 1, title: "爆款", author: "a", tags: ["模拟"], score: 8.0, hits: 9000, reviewCount: 20, fans: 1, board: "p", rank: 1, labels: [] },
      { id: 2, title: "高分新锐", author: "b", tags: ["动作"], score: 9.5, hits: 400, reviewCount: 12, fans: 1, board: "p", rank: 2, labels: [] },
      { id: 3, title: "未开分", author: "c", tags: ["休闲"], score: null, hits: 800, reviewCount: 0, fans: 1, board: "p", rank: 3, labels: [] }
    ];
    const heat = buildHeatBoard(pool, 10);
    const rising = buildRisingBoard(pool, 10);
    expect(heat.label).toBe("热度榜");
    expect(heat.entries[0]?.title).toBe("爆款");
    expect(rising.label).toBe("新锐榜");
    expect(rising.entries.some((item) => item.title === "未开分")).toBe(false);
    expect(rising.entries[0]?.title).toBe("高分新锐");
    expect(computeRisingScore(pool[1]!)).toBeGreaterThan(computeRisingScore(pool[0]!));
  });

  it("builds score buckets", () => {
    const buckets = buildScoreBuckets([
      { id: 1, title: "a", author: "a", tags: [], score: 9.2, hits: 1, reviewCount: 0, fans: 0, board: "b", rank: 1, labels: [] },
      { id: 2, title: "b", author: "b", tags: [], score: 8.1, hits: 1, reviewCount: 0, fans: 0, board: "b", rank: 2, labels: [] },
      { id: 3, title: "c", author: "c", tags: [], score: null, hits: 1, reviewCount: 0, fans: 0, board: "b", rank: 3, labels: [] }
    ]);
    expect(buckets.find((item) => item.label === "9.0+")?.count).toBe(1);
    expect(buckets.find((item) => item.label === "8.0-8.9")?.count).toBe(1);
  });
});

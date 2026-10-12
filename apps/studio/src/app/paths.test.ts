import { describe, expect, it } from "vitest";
import { fileName, languageForFile, sameProjectPath } from "./paths";

describe("path helpers", () => {
  it("compares project paths across separators, trailing slashes and case", () => {
    expect(sameProjectPath("C:\\Games\\Demo\\", "c:/games/demo")).toBe(true);
    expect(sameProjectPath("/a/demo", "/a/demo2")).toBe(false);
  });

  it("returns the last path segment", () => {
    expect(fileName("scripts/ui/main.lua")).toBe("main.lua");
    expect(fileName("main.lua")).toBe("main.lua");
  });

  it("maps extensions to editor languages", () => {
    expect(languageForFile("main.LUA")).toBe("lua");
    expect(languageForFile("tsconfig.jsonc")).toBe("json");
    expect(languageForFile("App.tsx")).toBe("typescript");
    expect(languageForFile("ci.yaml")).toBe("yaml");
    expect(languageForFile("README")).toBe("plaintext");
  });
});

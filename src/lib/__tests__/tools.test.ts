import { describe, expect, it } from "vitest";
import { searchTools, TOOLS } from "../tools";

const top = (query: string) => searchTools(query)[0]?.id;

describe("tool search", () => {
  it("finds tools by name, including partial words", () => {
    expect(top("merge")).toBe("merge");
    expect(top("comp")).toBe("compress");
    expect(top("pdf to word")).toBe("pdf-to-word");
    expect(top("HEIC")).toBe("heic-to-jpg");
  });

  it("finds tools by what people call the task", () => {
    expect(top("combine")).toBe("merge");
    expect(top("password")).toBe("protect");
    expect(top("remove password")).toBe("unlock");
    expect(top("gps")).toBe("sanitize");
    expect(top("black out")).toBe("redact");
    expect(top("signature")).toBe("sign");
    expect(searchTools("iphone").map((t) => t.id).slice(0, 2).sort()).toEqual(["heic-to-jpg", "sanitize"]);
  });

  it("needs every word to match, and lists all tools for an empty query", () => {
    expect(searchTools("xyzzy")).toEqual([]);
    expect(searchTools("merge xyzzy")).toEqual([]);
    expect(searchTools("  ")).toHaveLength(TOOLS.filter((t) => t.status === "ready").length);
  });
});

import { describe, expect, it } from "vitest";
import { detectFileKind, extensionsFor } from "../files";
import { getTool } from "../tools";

describe("file kinds", () => {
  it("classifies by type, falling back to the extension", () => {
    expect(detectFileKind({ name: "a.bin", type: "application/pdf" })).toBe("pdf");
    expect(detectFileKind({ name: "IMG_1.HEIC", type: "" })).toBe("image");
    expect(detectFileKind({ name: "notes.md", type: "" })).toBe("text");
    expect(detectFileKind({ name: "clip.ts", type: "" })).toBe("unknown");
  });

  it("lists the formats a tool takes briefly", () => {
    expect(extensionsFor(["pdf"])).toEqual([".pdf"]);
    expect(extensionsFor(["audio"])).toEqual(["audio (.mp3, .wav, .m4a, .aac…)"]);
    expect(extensionsFor(getTool("check-file")!.accepts)).toEqual(["Any file"]);
    expect(extensionsFor(getTool("batch")!.accepts)).toEqual(["PDF", "Images", "Word", "Excel", "PowerPoint", "Text", "Video", "Audio"]);
  });
});

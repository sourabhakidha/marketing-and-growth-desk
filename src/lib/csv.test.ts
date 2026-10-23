import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv.ts";

describe("csv", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });
  it("keeps numbers as numbers", () => expect(csvCell(-5)).toBe("-5"));
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("represents missing values as empty cells, never zero", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("starts with a UTF-8 BOM and uses CRLF", () => {
    const csv = toCsv(["a", "b"], [["सॉल्ट", 1]]);
    expect(csv.startsWith("﻿a,b\r\n")).toBe(true);
    expect(csv).toContain("सॉल्ट,1\r\n");
  });
});

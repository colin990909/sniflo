import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

function getRuleBody(selector: string) {
  const cssText = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
  const start = cssText.indexOf(`${selector} {`);
  if (start === -1) return "";

  const bodyStart = cssText.indexOf("{", start);
  const bodyEnd = cssText.indexOf("}", bodyStart);

  if (bodyStart === -1 || bodyEnd === -1) return "";
  return cssText.slice(bodyStart + 1, bodyEnd);
}

describe("index.css", () => {
  test("glass-card limits transitions to visual properties so resize drags stay in sync", () => {
    const glassCardRule = getRuleBody(".glass-card");

    expect(glassCardRule).toContain("transition:");
    expect(glassCardRule).not.toContain("transition: all");
    expect(glassCardRule).toContain("border-color");
    expect(glassCardRule).toContain("box-shadow");
    expect(glassCardRule).toContain("transform");
  });
});

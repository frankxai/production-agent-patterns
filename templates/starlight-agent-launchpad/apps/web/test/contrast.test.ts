import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid six-digit hex color: ${hex}`);
  }
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Launchpad muted text contrast", () => {
  it("keeps the shared muted token above WCAG AA on the lightest dark panel", () => {
    const token = css.match(/--text-muted-aa:\s*(#[0-9a-f]{6})\s*;/i)?.[1];
    expect(token).toBeTruthy();
    expect(contrastRatio(token!, "#181f29")).toBeGreaterThanOrEqual(4.5);
  });

  it("routes every previously failing text role through the accessible token", () => {
    expect(css.match(/color:\s*var\(--text-muted-aa\)/g)).toHaveLength(6);
    for (const retiredColor of [
      "#5f6467",
      "#676c70",
      "#73787b",
      "#74797a",
      "#767b7d",
      "#737773",
    ]) {
      expect(css).not.toContain(retiredColor);
    }
  });
});

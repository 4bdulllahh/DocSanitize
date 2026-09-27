import { describe, expect, it } from "vitest";
import { generatePassword, passwordStrength } from "../password";

describe("password strength", () => {
  it("rates common, short and repetitive passwords low", () => {
    expect(passwordStrength("")).toEqual({ score: 0, label: "" });
    expect(passwordStrength("Password")).toMatchObject({ score: 0, hint: expect.stringMatching(/most common/) });
    expect(passwordStrength("cat").score).toBe(0);
    expect(passwordStrength("aaaaaaaaaaaaaaaa").score).toBeLessThan(2);
    expect(passwordStrength("abcdefghijklmnop").score).toBeLessThan(2);
    expect(passwordStrength("summer").hint).toMatch(/12 characters/);
  });

  it("rates long, varied passwords high", () => {
    expect(passwordStrength("correct horse battery staple").score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength("T7k#q9Wz!3Pd").score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength(generatePassword())).toMatchObject({ score: 4, label: "Very strong" });
  });
});

describe("password generator", () => {
  it("makes distinct, readable passwords without look-alike characters", () => {
    const passwords = Array.from({ length: 50 }, generatePassword);
    expect(new Set(passwords).size).toBe(50);
    for (const p of passwords) expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}$/);
  });
});

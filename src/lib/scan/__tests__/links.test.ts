import { domainToUnicode } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeUrl, describeQr, punycodeToUnicode, registrableDomain } from "../links";

const flags = (url: string, shown?: string) => analyzeUrl(url, shown).flags.map((f) => `${f.severity}: ${f.text}`);

describe("web address checks", () => {
  it("finds the registered domain and decodes international names", () => {
    expect(registrableDomain("login.secure.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("a.b.example.com")).toBe("example.com");
    for (const label of ["xn--pypal-4ve", "xn--mnchen-3ya", "xn--80ak6aa92e", "xn--fsq"]) expect(punycodeToUnicode(label)).toBe(domainToUnicode(`${label}.com`).replace(/\.com$/, ""));
  });

  it("passes an ordinary link", () => {
    expect(analyzeUrl("https://www.example.com/docs?page=2")).toEqual({ severity: "info", flags: [], host: "www.example.com", domain: "example.com" });
  });

  it("flags the usual tricks", () => {
    expect(flags("https://paypal.com-account.verify.example.xyz/login")).toEqual([
      "high: Uses “paypal” in the address, but the site is example.xyz, which doesn't belong to paypal.",
      "info: A “.xyz” address: cheap domains like this are often used for spam.",
    ]);
    expect(flags("https://www.paypal.com@203.0.113.9/")).toEqual([
      "high: The part before “@” is only decoration: this link goes to 203.0.113.9.",
      "high: Goes to a bare IP address instead of a named website.",
    ]);
    expect(analyzeUrl("https://xn--pypal-4ve.com/").flags[0].text).toBe("Mixes Latin and Cyrillic letters, a way to imitate another site: “pаypal.com”.");
    expect(analyzeUrl("http://bit.ly/abc").flags.map((f) => f.severity)).toEqual(["medium", "medium"]);
    expect(analyzeUrl("javascript:alert(1)").severity).toBe("high");
    expect(flags("https://example.com/out?url=https%3A%2F%2Fevil.test%2F")).toEqual(["medium: Passes you on to another site: evil.test."]);
    expect(flags("https://evil.test/", "www.mybank.com")).toEqual(["high: The text shows “www.mybank.com”, but the link goes to evil.test."]);
    expect(flags("https://www.mybank.com/login", "mybank.com")).toEqual([]);
    expect(analyzeUrl("https://accounts.google.com/").flags).toEqual([]);
    expect(analyzeUrl("https://report.zip/").severity).toBe("medium");
  });
});

describe("QR code contents", () => {
  it("describes common payloads", () => {
    expect(describeQr("WIFI:T:WPA;S:Cafe\\;Guest;P:secret;;")).toMatchObject({ kind: "wifi", details: ["Network: Cafe;Guest", "Security: WPA", "Includes the password"], flags: [] });
    expect(describeQr("otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP").flags[0].severity).toBe("high");
    expect(describeQr("BCD\n002\n1\nSCT\n\nRed Cross\nDE89370400440532013000\nEUR12.50")).toMatchObject({ kind: "payment", details: ["To: Red Cross", "Account: DE89370400440532013000", "Amount: EUR12.50"] });
    expect(describeQr("https://bit.ly/x").kind).toBe("url");
    expect(describeQr("Hello")).toMatchObject({ kind: "text", details: ["Hello"] });
  });
});

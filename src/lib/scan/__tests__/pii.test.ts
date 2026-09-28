import { describe, expect, it } from "vitest";
import type { TextPage } from "../../office/text-layout";
import { findPii, luhn, validIban } from "../pii";
import { findPiiInPages } from "../pii-pdf";

const found = (text: string) => findPii(text).map((m) => [m.kind, m.value]);

describe("personal data patterns", () => {
  it("finds emails, cards, IBANs, national numbers, IPs and labelled birth dates", () => {
    const text = [
      "Contact jane.doe+work@example.co.uk or müller@beispiel.de.",
      "Card: 4111 1111 1111 1111 2026, not 4111 1111 1111 1112.",
      "IBAN DE89 3704 0044 0532 0130 00 and bad GB00 0000 0000 0000 0000 00.",
      "SSN 123-45-6789, invalid 000-12-3456. NI number AB 12 34 56 C, invalid QQ 12 34 56 C.",
      "Server 192.168.10.254, not version 1.2.3.4 or 256.1.1.1.",
      "Date of birth: 14/03/1987. Invoice date 01/02/2026. Born on March 3, 1990.",
    ].join("\n");
    expect(found(text)).toEqual([
      ["email", "jane.doe+work@example.co.uk"],
      ["email", "müller@beispiel.de"],
      ["card", "4111 1111 1111 1111"],
      ["iban", "DE89 3704 0044 0532 0130 00"],
      ["ssn", "123-45-6789"],
      ["nino", "AB 12 34 56 C"],
      ["ip", "192.168.10.254"],
      ["dob", "14/03/1987"],
      ["dob", "March 3, 1990"],
    ]);
  });

  it("finds phone numbers in common formats but not dates, amounts or IDs", () => {
    expect(found("Call +44 20 7946 0958, (555) 123-4567, 0301 234 5678 or 555.123.4567.")).toEqual([
      ["phone", "+44 20 7946 0958"],
      ["phone", "(555) 123-4567"],
      ["phone", "0301 234 5678"],
      ["phone", "555.123.4567"],
    ]);
    expect(found("Total 1,250.00 on 2026-09-28, order 12345678, ref 2026.09.28, qty 10 x 20.")).toEqual([]);
  });

  it("checks checksums", () => {
    expect(luhn("4012888888881881")).toBe(true);
    expect(luhn("4012888888881882")).toBe(false);
    expect(validIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(validIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });
});

describe("personal data in a PDF page", () => {
  it("maps matches to boxes over the words, including form fields", () => {
    const page: TextPage = {
      width: 600,
      height: 800,
      items: [
        { text: "Email:", x: 100, y: 100, width: 36, size: 12 },
        { text: "jo@example.com", x: 140, y: 100, width: 84, size: 12 },
      ],
    };
    const findings = findPiiInPages([page], [[{ text: "Call 0301 234 5678", rect: [300, 200, 500, 220] }]]);
    expect(findings.map((f) => [f.kind, f.value, f.inAnnotation])).toEqual([
      ["email", "jo@example.com", false],
      ["phone", "0301 234 5678", true],
    ]);
    const [box] = findings[0].boxes;
    expect(box.x * 600).toBeCloseTo(139, 0);
    expect((box.x + box.width) * 600).toBeCloseTo(225, 0);
    expect(findings[0].context).toBe("Email: [[jo@example.com]]");
    expect(findings[1].boxes).toHaveLength(1);
  });

  it("keeps lines apart, so a match doesn't run into the next line", () => {
    const line = (text: string, y: number) => ({ text, x: 56, y, width: text.length * 7, size: 14 });
    const page: TextPage = {
      width: 595,
      height: 842,
      items: [line("Email: jane.doe@example.com", 100), line("Phone: +1 415 555 0132", 130), line("IBAN: GB82 WEST 1234 5698 7654 32", 160)],
    };
    const findings = findPiiInPages([page], [[]]);
    expect(findings.map((f) => [f.kind, f.value])).toEqual([
      ["email", "jane.doe@example.com"],
      ["phone", "+1 415 555 0132"],
      ["iban", "GB82 WEST 1234 5698 7654 32"],
    ]);
  });
});

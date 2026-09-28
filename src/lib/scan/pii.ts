import { msg } from "@/i18n/msg";
/*
 * Finds personal data in text: email addresses, phone numbers, payment card numbers (Luhn
 * checked), IBANs (checksum checked), US Social Security and UK National Insurance numbers, IP
 * addresses and labelled dates of birth. Pattern matching only, so it can miss things (names,
 * addresses) and every match should be reviewed; the checksums keep false alarms down.
 */

export type PiiKind = "email" | "phone" | "card" | "iban" | "ssn" | "nino" | "ip" | "dob";

export interface PiiMatch {
  kind: PiiKind;
  value: string;
  /** Position in the searched text. */
  start: number;
  end: number;
}

export const PII_LABELS: Record<PiiKind, { name: string; plural: string }> = {
  email: { name: msg("Email address"), plural: msg("Email addresses") },
  phone: { name: msg("Phone number"), plural: msg("Phone numbers") },
  card: { name: msg("Payment card number"), plural: msg("Payment card numbers") },
  iban: { name: msg("Bank account (IBAN)"), plural: msg("Bank accounts (IBAN)") },
  ssn: { name: msg("US Social Security number"), plural: msg("US Social Security numbers") },
  nino: { name: msg("UK National Insurance number"), plural: msg("UK National Insurance numbers") },
  ip: { name: "IP address", plural: "IP addresses" },
  dob: { name: msg("Date of birth"), plural: msg("Dates of birth") },
};

/** Checked first; a later kind can't overlap an earlier match. */
const ORDER: PiiKind[] = ["email", "card", "iban", "ssn", "nino", "dob", "ip", "phone"];

const digits = (s: string) => s.replace(/\D/g, "");

export function luhn(number: string): boolean {
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** ISO 13616 check: move the first four characters to the end, letters to numbers, mod 97 = 1. */
export function validIban(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  let rest = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) {
    const value = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of value) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = `(?:\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.?\\s+(?:${MONTHS})\\.?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4})`;

/** `shrink`: a number followed by more digit groups is shortened until it checks out. */
const PATTERNS: Record<PiiKind, { regex: RegExp; group?: number; valid?: (value: string) => boolean; shrink?: boolean }> = {
  email: { regex: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  card: {
    regex: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g,
    valid: (v) => {
      const d = digits(v);
      return d.length >= 13 && d.length <= 19 && /^[2-6]/.test(d) && luhn(d) && !/^(\d)\1+$/.test(d);
    },
    shrink: true,
  },
  iban: { regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, valid: validIban, shrink: true },
  ssn: { regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  nino: { regex: /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g },
  dob: {
    regex: new RegExp(`\\b(?:date of birth|birth ?date|d\\.?o\\.?b\\.?|born(?: on)?|geburtsdatum|geboren(?: am)?|date de naissance|né(?:e)? le|fecha de nacimiento|data di nascita)\\s*[:\\-–]?\\s*(${DATE})`, "giu"),
    group: 1,
  },
  ip: {
    regex: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
    // Version-number look-alikes such as 1.0.0.1 are left out.
    valid: (v) => !/^[0-2]\.\d\.\d\.\d$/.test(v),
  },
  phone: {
    regex: /(?<![\w+])(?:\+|00)?\(?\d[\d\s().-]{6,18}\d(?![\w])/g,
    valid: (v) => {
      const d = digits(v);
      if (d.length < 8 || d.length > 15) return false;
      // Dates, times and plain numbers aren't phone numbers.
      if (/^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(v.trim())) return false;
      if (/^\d+$/.test(v) && !/^0\d{9,10}$/.test(v)) return false;
      if (/^\d+\.\d+$/.test(v)) return false;
      return /^(?:\+|00|\(|0)/.test(v) || /\d{3}[\s.-]\d{3}[\s.-]\d{4}/.test(v);
    },
  },
};

/** Every piece of personal data found in `text`, in order of position. */
export function findPii(text: string, kinds: readonly PiiKind[] = ORDER): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const taken = (start: number, end: number) => matches.some((m) => start < m.end && end > m.start);
  for (const kind of ORDER) {
    if (!kinds.includes(kind)) continue;
    const { regex, group, valid, shrink } = PATTERNS[kind];
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      let value = (group ? m[group] : m[0]).trim();
      const start = (m.index ?? 0) + (group ? m[0].indexOf(m[group]) : m[0].indexOf(value));
      while (valid && shrink && !valid(value) && value.includes(" ")) value = value.slice(0, value.lastIndexOf(" ")).trim();
      if (valid && !valid(value)) continue;
      const end = start + value.length;
      if (taken(start, end)) continue;
      matches.push({ kind, value, start, end });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

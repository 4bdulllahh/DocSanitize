export interface PasswordStrength {
  /** 0 (too weak) to 4 (very strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** What would make it stronger. */
  hint?: string;
}

const COMMON = new Set([
  "password", "passw0rd", "123456", "12345678", "123456789", "1234567890", "qwerty", "qwertyuiop", "abc123",
  "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "football", "baseball", "sunshine", "princess",
  "master", "shadow", "trustno1", "111111", "000000", "secret", "changeme", "p@ssw0rd", "login", "starwars",
]);

const LABELS = ["Too weak", "Weak", "Fair", "Strong", "Very strong"] as const;

/** A rough entropy estimate: character variety × length, discounted for repeats and runs like "1234". */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "" };
  if (COMMON.has(password.toLowerCase())) return { score: 0, label: LABELS[0], hint: "This is one of the most common passwords." };

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^\w\s]|_/.test(password)) pool += 33;
  if (/\s/.test(password)) pool += 1;
  if (/[^\x00-\x7F]/.test(password)) pool += 100;

  // Characters that repeat or continue a run (aaa, 1234, abcd) add little.
  let effective = 0;
  const chars = Array.from(password);
  chars.forEach((ch, i) => {
    const prev = chars[i - 1]?.codePointAt(0);
    const code = ch.codePointAt(0)!;
    effective += prev === undefined || Math.abs(code - prev) > 1 ? 1 : 0.25;
  });
  const bits = effective * Math.log2(Math.max(pool, 2));

  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  let hint: string | undefined;
  if (score < 3) {
    if (chars.length < 12) hint = "Use at least 12 characters.";
    else if (pool <= 36) hint = "Mix upper and lower case, numbers or symbols.";
    else hint = "Avoid repeated characters and runs like 1234.";
  }
  return { score: score as PasswordStrength["score"], label: LABELS[score], hint };
}

// No look-alikes (0/O, 1/l/I), so a generated password can be read out or typed from paper.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** 20 random characters in four groups, e.g. "hT7kq-Wz3Pd-9mXcR-f2VbN" (about 116 bits). */
export function generatePassword(): string {
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && out.length < 20) out.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  return [0, 5, 10, 15].map((i) => out.slice(i, i + 5).join("")).join("-");
}

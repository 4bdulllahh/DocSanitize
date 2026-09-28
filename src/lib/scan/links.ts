import type { Severity } from "./findings";
import { msg } from "@/i18n/msg";

/*
 * Warning signs in web addresses and QR codes, judged from the address itself. Nothing is looked
 * up online (that would tell a server which links you're checking), so a clean result means "no
 * obvious tricks", not "safe".
 */

export interface Flag {
  severity: Severity;
  text: string;
}

export interface UrlVerdict {
  severity: Severity;
  flags: Flag[];
  /** Host as a person reads it (international names decoded). */
  host: string | null;
  /** The part of the host someone registered, e.g. "example.co.uk". */
  domain: string | null;
}

const SHORTENERS = new Set("bit.ly tinyurl.com t.co goo.gl ow.ly is.gd buff.ly rebrand.ly cutt.ly shorturl.at tiny.cc s.id rb.gy t.ly lnkd.in qrco.de qr.net bl.ink short.io v.gd clck.ru u.to shorte.st adf.ly tr.im x.co soo.gd bitly.com trib.al db.tt".split(" "));

/** Second-level endings sold like top-level ones: the registered name sits one label further left. */
const TWO_LEVEL = new Set(
  "co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk com.au net.au org.au edu.au gov.au co.nz org.nz co.jp ne.jp or.jp ac.jp co.in net.in org.in gov.in com.br net.br org.br gov.br com.mx com.ar com.co com.pe com.tr com.cn net.cn org.cn gov.cn com.hk com.tw com.sg com.my com.ph com.vn com.pk com.sa com.eg co.za co.il co.kr or.kr com.ng co.ke com.ua co.id com.bd com.np github.io gitlab.io pages.dev vercel.app netlify.app herokuapp.com web.app firebaseapp.com azurewebsites.net blogspot.com wordpress.com wixsite.com weebly.com glitch.me".split(" "),
);

/** Brands phishing imitates, with the domains that really belong to them. */
const BRANDS: Record<string, string[]> = {
  paypal: ["paypal.com", "paypal.me", "paypalobjects.com"],
  apple: ["apple.com", "icloud.com", "apple.co"],
  icloud: ["icloud.com", "apple.com"],
  microsoft: ["microsoft.com", "live.com", "office.com", "outlook.com", "microsoftonline.com", "sharepoint.com", "onedrive.com", "msn.com", "azure.com", "office365.com", "windows.net"],
  office365: ["office.com", "office365.com", "microsoft.com"],
  outlook: ["outlook.com", "live.com", "office.com", "microsoft.com"],
  google: ["google.com", "gmail.com", "youtube.com", "googleusercontent.com", "goo.gl", "g.co", "google.co.uk"],
  gmail: ["gmail.com", "google.com"],
  amazon: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.in", "amazon.ca", "amazon.co.jp", "amazon.es", "amazon.it", "amazon.ae", "amazon.sa", "amzn.to", "aws.amazon.com", "amazonaws.com"],
  netflix: ["netflix.com"],
  facebook: ["facebook.com", "fb.com", "fb.me", "meta.com"],
  instagram: ["instagram.com"],
  whatsapp: ["whatsapp.com", "wa.me", "whatsapp.net"],
  linkedin: ["linkedin.com", "lnkd.in"],
  dhl: ["dhl.com", "dhl.de", "dhl.co.uk"],
  fedex: ["fedex.com"],
  usps: ["usps.com"],
  royalmail: ["royalmail.com"],
  dropbox: ["dropbox.com", "db.tt"],
  docusign: ["docusign.com", "docusign.net"],
  adobe: ["adobe.com"],
  chase: ["chase.com"],
  wellsfargo: ["wellsfargo.com"],
  bankofamerica: ["bankofamerica.com"],
  hsbc: ["hsbc.com", "hsbc.co.uk"],
  barclays: ["barclays.co.uk", "barclays.com"],
  coinbase: ["coinbase.com"],
  binance: ["binance.com"],
  steam: ["steampowered.com", "steamcommunity.com"],
  steamcommunity: ["steamcommunity.com"],
  irs: ["irs.gov"],
  hmrc: ["gov.uk"],
};

/** Endings that look like file names (".zip", ".mov") or that are mostly used for spam. */
const FILE_LIKE_TLDS = new Set(["zip", "mov"]);
const CHEAP_TLDS = new Set("top xyz click work rest loan country gq tk ml cf ga icu cyou cam buzz monster sbs lol quest bar".split(" "));

const RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
export const worst = (flags: Flag[]): Severity => flags.reduce<Severity>((s, f) => (RANK[f.severity] < RANK[s] ? f.severity : s), "info");

// ---------------------------------------------------------------------------- Punycode (RFC 3492)

export function punycodeToUnicode(label: string): string {
  if (!label.startsWith("xn--")) return label;
  const input = label.slice(4);
  const base = 36;
  const out: number[] = [];
  const dash = input.lastIndexOf("-");
  for (let i = 0; i < Math.max(0, dash); i++) out.push(input.charCodeAt(i));
  let [n, i, bias] = [128, 0, 72];
  for (let pos = dash > 0 ? dash + 1 : 0; pos < input.length; ) {
    const old = i;
    for (let w = 1, k = base; ; k += base) {
      const c = input.charCodeAt(pos++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base || pos > input.length) return label;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const length = out.length + 1;
    let delta = old === 0 ? Math.floor((i - old) / 700) : (i - old) >> 1;
    delta += Math.floor(delta / length);
    let k = 0;
    for (; delta > 455; k += base) delta = Math.floor(delta / 35);
    bias = k + Math.floor((36 * delta) / (delta + 38));
    n += Math.floor(i / length);
    i %= length;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** The registrable domain of a host (the "example.co.uk" of "login.example.co.uk"). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

const SCRIPTS: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
];

/** Check a web address; `shown` is the text a reader sees for the link, if any. */
export function analyzeUrl(raw: string, shown?: string): UrlVerdict {
  const flags: Flag[] = [];
  const add = (severity: Severity, text: string) => flags.push({ severity, text });
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { severity: "medium", flags: [{ severity: "medium", text: msg("Not a valid web address.") }], host: null, domain: null };
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (["javascript", "data", "vbscript", "file"].includes(scheme)) {
    add("high", scheme === "file" ? msg("Opens a file on your computer or network instead of a web page.") : msg("Runs code or loads hidden content instead of opening a web page."));
    return { severity: "high", flags, host: null, domain: null };
  }
  if (scheme !== "http" && scheme !== "https") return { severity: "info", flags: [{ severity: "info", text: msg`A “${scheme}:” link, not a web page.` }], host: null, domain: null };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const unicode = hostname.split(".").map(punycodeToUnicode).join(".");
  const domain = registrableDomain(unicode);
  if (scheme === "http") add("medium", msg("Not encrypted (http, not https): what you send can be read or changed on the way."));
  if (url.username || url.password || /^[a-z]+:\/\/[^/]*@/i.test(raw)) add("high", msg`The part before “@” is only decoration: this link goes to ${unicode}.`);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) add("high", msg("Goes to a bare IP address instead of a named website."));
  if (hostname.split(".").some((l) => l.startsWith("xn--"))) {
    const scripts = SCRIPTS.filter(([, re]) => re.test(unicode)).map(([name]) => name);
    add(scripts.length > 1 ? "high" : "medium", scripts.length > 1 ? msg`Mixes ${scripts.join(" and ")} letters, a way to imitate another site: “${unicode}”.` : msg`Uses international characters: “${unicode}”. Check it's the site you expect.`);
  }
  if (SHORTENERS.has(domain) || SHORTENERS.has(hostname)) add("medium", msg("A shortened link: where it really goes is hidden until it's opened."));
  const labels = unicode.toLowerCase().split(".");
  const name = domain.split(".")[0];
  for (const [brand, owned] of Object.entries(BRANDS)) {
    if (owned.includes(domain) || owned.some((d) => unicode.toLowerCase().endsWith(`.${d}`))) continue;
    const inHost = labels.some((l) => l === brand || l.split(/[-_]/).includes(brand)) || (name !== brand && name.includes(brand));
    if (inHost) {
      add("high", msg`Uses “${brand}” in the address, but the site is ${domain}, which doesn't belong to ${brand}.`);
      break;
    }
  }
  const tld = labels[labels.length - 1];
  if (FILE_LIKE_TLDS.has(tld)) add("medium", msg`Ends in “.${tld}”, which looks like a file name but is a website.`);
  else if (CHEAP_TLDS.has(tld)) add("info", msg`A “.${tld}” address: cheap domains like this are often used for spam.`);
  if (url.port && url.port !== "80" && url.port !== "443") add("medium", msg`Uses an unusual port (${url.port}).`);
  if (labels.length > 5) add("info", msg("Has many subdomains, which can bury the real site name."));
  for (const [key, value] of url.searchParams) {
    if (/^(url|redirect|redirect_uri|next|target|dest|destination|u|r|continue|return|goto|link)$/i.test(key) && /^https?:\/\//i.test(value)) {
      try {
        const onward = new URL(value).hostname;
        if (registrableDomain(onward) !== domain) add("medium", msg`Passes you on to another site: ${onward}.`);
      } catch {
        // Not a usable address.
      }
      break;
    }
  }
  if (raw.length > 300) add("info", msg("A very long address, which makes it hard to see where it goes."));
  if (shown) {
    const match = /(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})/u.exec(shown.trim());
    if (match && registrableDomain(match[1]) !== domain) {
      add("high", msg`The text shows “${match[1]}”, but the link goes to ${unicode}.`);
    }
  }
  return { severity: worst(flags), flags, host: unicode, domain };
}

// ---------------------------------------------------------------------------- QR code contents

export interface QrContent {
  kind: "url" | "wifi" | "email" | "phone" | "sms" | "contact" | "location" | "authenticator" | "payment" | "text";
  label: string;
  /** Key facts, e.g. network name, recipient. */
  details: string[];
  /** For links: the address checked. */
  url?: string;
  flags: Flag[];
}

const field = (text: string, key: string) => new RegExp(`(?:^|;)${key}:((?:\\\\.|[^;])*)`, "i").exec(text)?.[1]?.replace(/\\(.)/g, "$1");

export function describeQr(raw: string): QrContent {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (/^https?:\/\//.test(lower) || /^www\.[^\s]+\.[a-z]{2,}/.test(lower)) {
    const verdict = analyzeUrl(text);
    return { kind: "url", label: msg("Web link"), details: [text], url: text, flags: verdict.flags };
  }
  if (lower.startsWith("wifi:")) {
    const body = text.slice(5);
    const security = field(body, "T") || "none";
    return {
      kind: "wifi",
      label: "Wi-Fi network",
      details: [`Network: ${field(body, "S") ?? "?"}`, `Security: ${security}`, ...(field(body, "P") ? [msg("Includes the password")] : [])],
      flags: /^(nopass|none|)$/i.test(security) ? [{ severity: "medium", text: msg("An open network: others on it can see unencrypted traffic.") }] : [],
    };
  }
  if (lower.startsWith("mailto:")) return { kind: "email", label: "Email", details: [text.slice(7).split("?")[0]], flags: [] };
  if (lower.startsWith("tel:")) return { kind: "phone", label: msg("Phone call"), details: [text.slice(4)], flags: [{ severity: "info", text: msg("Calls this number when opened.") }] };
  if (lower.startsWith("smsto:") || lower.startsWith("sms:")) return { kind: "sms", label: msg("Text message"), details: [text.replace(/^smsto?:/i, "").replace(/:/, " — ")], flags: [{ severity: "medium", text: msg("Prepares a text message; premium-rate numbers can cost money.") }] };
  if (lower.startsWith("begin:vcard") || lower.startsWith("mecard:")) {
    const name = /\nFN:(.*)/i.exec(text)?.[1] ?? field(text.slice(7), "N") ?? "Contact";
    return { kind: "contact", label: msg("Contact card"), details: [name.trim()], flags: [] };
  }
  if (lower.startsWith("geo:")) return { kind: "location", label: msg("Map location"), details: [text.slice(4)], flags: [] };
  if (lower.startsWith("otpauth://")) {
    return { kind: "authenticator", label: msg("Two-factor login code"), details: [decodeURIComponent(text.replace(/^otpauth:\/\/[^/]+\//i, "").split("?")[0])], flags: [{ severity: "high", text: msg("Adds a login code to your authenticator app. Only scan this from the website you're setting up; anyone with this code can generate your codes.") }] };
  }
  if (/^(bitcoin|ethereum|litecoin|monero|upi):/i.test(text) || /^BCD\r?\n/.test(text)) {
    const epc = /^BCD\r?\n/.test(text) ? text.split(/\r?\n/) : null;
    const details = epc ? [`To: ${epc[5] ?? "?"}`, `Account: ${epc[6] ?? "?"}`, ...(epc[7] ? [`Amount: ${epc[7]}`] : [])] : [text.split("?")[0]];
    return { kind: "payment", label: epc ? msg("Bank transfer") : msg("Payment request"), details, flags: [{ severity: "high", text: msg("Starts a payment. Check the recipient before paying; fake payment codes are stuck over real ones.") }] };
  }
  return { kind: "text", label: "Text", details: [text.length > 300 ? `${text.slice(0, 300)}…` : text], flags: [] };
}

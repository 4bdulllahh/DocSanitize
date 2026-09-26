import { compact, entry } from "./classify";
import type { MetadataEntry } from "./types";

/*
 * Minimal XMP reader. Runs inside a Web Worker, where DOMParser is unavailable, so it walks the
 * packet with a small tokenizer. It collects every property value it finds — simple properties,
 * rdf:Description attributes and rdf:Seq/Bag/Alt list items — which is what an audit needs.
 */

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// Structural attributes/elements that carry no information of their own.
const IGNORED_ATTRIBUTES = /^(xmlns(:|$)|rdf:about$|rdf:parseType$|xml:lang$|rdf:resource$)/;
const CONTAINER = /^(x:xmpmeta|x:xapmeta|rdf:RDF|rdf:Description|rdf:Seq|rdf:Bag|rdf:Alt|rdf:li)$/;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    switch (e.toLowerCase()) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/** Returns property name -> list of values, in document order. */
export function readXmpProperties(xml: string): Map<string, string[]> {
  const props = new Map<string, string[]>();
  const stack: string[] = [];
  const add = (name: string, raw: string) => {
    const value = decodeEntities(raw).trim();
    if (!value) return;
    const list = props.get(name) ?? [];
    list.push(value);
    props.set(name, list);
  };
  const owner = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (!CONTAINER.test(stack[i])) return stack[i];
    return null;
  };

  for (const m of xml.matchAll(TOKEN)) {
    const [, cdata, closing, tag, attrs, selfClosing, text] = m;
    if (cdata !== undefined || text !== undefined) {
      const name = owner();
      if (name) add(name, cdata ?? text);
      continue;
    }
    if (!tag) continue; // comment or processing instruction
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at !== -1) stack.length = at;
      continue;
    }
    for (const a of (attrs ?? "").matchAll(ATTRIBUTE)) {
      const name = a[1];
      if (!IGNORED_ATTRIBUTES.test(name)) add(name, a[2] ?? a[3] ?? "");
    }
    if (!selfClosing) stack.push(tag);
  }
  return props;
}

export function xmpEntries(xml: string, group = "XMP"): MetadataEntry[] {
  return compact(
    [...readXmpProperties(xml)].map(([name, values]) =>
      entry(group, name, [...new Set(values)].join(", ")),
    ),
  );
}

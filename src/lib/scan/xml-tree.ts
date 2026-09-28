/*
 * A minimal XML tree for editing Office parts without disturbing them: attributes, text,
 * comments and declarations are kept byte for byte, and only elements a transform drops or
 * unwraps change. Not a validating parser: it expects well-formed XML, which Office writes.
 */

export interface XmlElement {
  type: "element";
  name: string;
  /** Raw attribute text, including the leading whitespace. */
  attrs: string;
  children: XmlNode[];
  selfClosing: boolean;
}

export type XmlNode = XmlElement | { type: "raw"; text: string };

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+/g;

export function parseXml(xml: string): XmlNode[] {
  const root: XmlElement = { type: "element", name: "", attrs: "", children: [], selfClosing: false };
  const stack: XmlElement[] = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const [token, close, name, attrs, self] = m;
    const parent = stack[stack.length - 1];
    if (!name) {
      parent.children.push({ type: "raw", text: token });
    } else if (close) {
      // Pop to the matching element (tolerates stray end tags).
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else {
      const el: XmlElement = { type: "element", name, attrs: attrs ?? "", children: [], selfClosing: Boolean(self) };
      parent.children.push(el);
      if (!self) stack.push(el);
    }
  }
  return root.children;
}

export function serializeXml(nodes: XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "raw") out += node.text;
    else if (node.selfClosing) out += `<${node.name}${node.attrs}/>`;
    else out += `<${node.name}${node.attrs}>${serializeXml(node.children)}</${node.name}>`;
  }
  return out;
}

export type Verdict = "keep" | "drop" | "unwrap";

/** Rewrite a tree: each element is kept (and visited), dropped with its content, or replaced by its content. */
export function transform(nodes: XmlNode[], decide: (el: XmlElement) => Verdict): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    if (node.type === "raw") {
      out.push(node);
      continue;
    }
    const verdict = decide(node);
    if (verdict === "drop") continue;
    const children = transform(node.children, decide);
    if (verdict === "unwrap") out.push(...children);
    else out.push({ ...node, children });
  }
  return out;
}

/** Remove attributes whose name matches (e.g. Word's rsid revision ids), in place. */
export function stripAttributes(nodes: XmlNode[], name: RegExp): number {
  let removed = 0;
  for (const el of elements(nodes)) {
    el.attrs = el.attrs.replace(/\s+([\w:.-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, (whole, attrName: string) => {
      if (!name.test(attrName)) return whole;
      removed++;
      return "";
    });
  }
  return removed;
}

/** Every element in document order. */
export function* elements(nodes: XmlNode[]): Generator<XmlElement> {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    yield node;
    yield* elements(node.children);
  }
}

export const hasDescendant = (el: XmlElement, name: string) => [...elements(el.children)].some((e) => e.name === name);

export function attr(el: XmlElement, name: string): string | undefined {
  const m = new RegExp(`\\s${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(el.attrs);
  return m ? decodeXml(m[1] ?? m[2]) : undefined;
}

/** Text content of an element (entities decoded). */
export function textOf(el: XmlElement | XmlNode[]): string {
  const nodes = Array.isArray(el) ? el : el.children;
  let out = "";
  for (const node of nodes) {
    if (node.type === "raw") {
      if (!node.text.startsWith("<")) out += decodeXml(node.text);
      else if (node.text.startsWith("<![CDATA[")) out += node.text.slice(9, -3);
    } else {
      out += textOf(node);
    }
  }
  return out;
}

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? _;
  });
}

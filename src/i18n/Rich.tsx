import { Fragment, type ReactNode } from "react";

/**
 * A translated text with elements in it: t() leaves `{name}` for values it wasn't given, and this
 * puts the elements there. <Rich text={t("{count} of {total} selected", { total })} values={{ count: <b>3</b> }} />
 */
export function Rich({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <Fragment key={i}>{part in values ? values[part] : `{${part}}`}</Fragment> : part))}
    </>
  );
}

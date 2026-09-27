import fontkit from "@cantoo/fontkit";
import {
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFWidgetAnnotation,
} from "@cantoo/pdf-lib";
import { Encodings } from "@cantoo/pdf-lib/standard-fonts";
import { ProcessingError } from "../errors";
import type { FontFiles } from "../office/flow";
import type { Box } from "./edit/types";
import { loadPdf, savePdf } from "./load";
import { pageGeometry, type PageGeometry } from "./stamp";

/* Reading and filling AcroForm fields. */

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export interface FieldWidget {
  page: number;
  /** Displayed rectangle (points from the top-left of the page as shown). */
  box: Box;
  /** Radio buttons: the option this widget selects. */
  option?: string;
}

export interface FormField {
  name: string;
  kind: FieldKind;
  /** text: string; checkbox: boolean; radio/dropdown: string ("" = none); list: string[]. */
  value: string | boolean | string[];
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
  /** Dropdowns that also accept typed values. */
  editable?: boolean;
  multiple?: boolean;
  readOnly: boolean;
  required: boolean;
  widgets: FieldWidget[];
}

export interface FormInfo {
  fields: FormField[];
  /** An XFA form (Adobe LiveCycle); its AcroForm fields, if any, are what we fill. */
  xfa: boolean;
}

export type FieldValues = Record<string, string | boolean | string[]>;

/** User space rectangle -> displayed box, for any rotation. */
function displayBox({ rotation, box }: PageGeometry, r: { x: number; y: number; width: number; height: number }): Box {
  const corners = [
    [r.x, r.y],
    [r.x + r.width, r.y + r.height],
  ].map(([x, y]) => {
    switch (rotation) {
      case 90:
        return [y - box.y, x - box.x];
      case 180:
        return [box.x + box.width - x, y - box.y];
      case 270:
        return [box.y + box.height - y, box.x + box.width - x];
      default:
        return [x - box.x, box.y + box.height - y];
    }
  });
  const us = corners.map((c) => c[0]);
  const vs = corners.map((c) => c[1]);
  return { x: Math.min(...us), y: Math.min(...vs), width: Math.abs(us[1] - us[0]), height: Math.abs(vs[1] - vs[0]) };
}

function widgetPage(doc: PDFDocument, widget: PDFWidgetAnnotation, pageOf: Map<string, number>, widgetRefs: Map<string, number>): number {
  const p = widget.P();
  if (p instanceof PDFRef && pageOf.has(p.toString())) return pageOf.get(p.toString())!;
  // Many writers leave /P out: find the page whose /Annots lists this widget.
  const ref = doc.context.getObjectRef(widget.dict);
  return ref ? (widgetRefs.get(ref.toString()) ?? -1) : -1;
}

function kindOf(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "list";
  if (field instanceof PDFSignature) return "signature";
  return "button";
}

export async function readForm(bytes: Uint8Array): Promise<FormInfo> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const pageOf = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const widgetRefs = new Map<string, number>();
  pages.forEach((p, i) => p.node.Annots()?.asArray().forEach((ref) => widgetRefs.set(ref.toString(), i)));
  const geometries = pages.map(pageGeometry);
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  const xfa = acroForm instanceof PDFDict && acroForm.has(PDFName.of("XFA"));

  const fields: FormField[] = [];
  for (const field of doc.getForm().getFields()) {
    const kind = kindOf(field);
    const widgets = field.acroField.getWidgets();
    // A radio widget's option: the field's /Opt export value when there is one per widget, else its on-state.
    const radioOptions = field instanceof PDFRadioGroup ? field.getOptions() : [];
    const onValues = field instanceof PDFRadioGroup ? widgets.map((w, i) => (radioOptions.length === widgets.length ? radioOptions[i] : (w.getOnValue()?.decodeText() ?? ""))) : [];
    const entry: FormField = {
      name: field.getName(),
      kind,
      value: "",
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      widgets: widgets.flatMap((w, i) => {
        const page = widgetPage(doc, w, pageOf, widgetRefs);
        if (page === -1) return [];
        const r = w.getRectangle();
        return [{ page, box: displayBox(geometries[page], r), ...(field instanceof PDFRadioGroup ? { option: onValues[i] } : {}) }];
      }),
    };
    if (field instanceof PDFTextField) {
      entry.value = field.getText() ?? "";
      entry.multiline = field.isMultiline();
      entry.maxLength = field.getMaxLength();
    } else if (field instanceof PDFCheckBox) {
      entry.value = field.isChecked();
    } else if (field instanceof PDFRadioGroup) {
      entry.value = field.getSelected() ?? "";
      entry.options = field.getOptions();
    } else if (field instanceof PDFDropdown) {
      entry.value = field.getSelected()[0] ?? "";
      entry.options = field.getOptions();
      entry.editable = field.isEditable();
    } else if (field instanceof PDFOptionList) {
      entry.value = field.getSelected();
      entry.options = field.getOptions();
      entry.multiple = field.isMultiselect();
    }
    fields.push(entry);
  }
  return { fields, xfa };
}

export interface FillOptions {
  /** Draw the values into the pages and remove the fields. */
  flatten: boolean;
}

/** Set field values (by field name), refresh how they look, and optionally flatten the form. */
export async function fillForm(bytes: Uint8Array, values: FieldValues, options: FillOptions, files: FontFiles): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  if (form.getFields().length === 0) throw new ProcessingError("This PDF has no fillable fields.", "invalid");

  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    if (field instanceof PDFTextField && typeof value === "string") {
      const max = field.getMaxLength();
      field.setText(max !== undefined ? value.slice(0, max) : value);
    } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
      if (value) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup && typeof value === "string") {
      if (value) field.select(value);
      else field.clear();
    } else if (field instanceof PDFDropdown && typeof value === "string") {
      if (value) field.select(value, field.isEditable());
      else field.clear();
    } else if (field instanceof PDFOptionList && Array.isArray(value)) {
      if (value.length) field.select(value);
      else field.clear();
    }
  }

  // The standard Helvetica covers WinAnsi only; other text is drawn in Liberation Sans.
  const typed = Object.values(values).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : [])).join("");
  const latin = Array.from(typed).every((ch) => ch === "\n" || Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!));
  if (latin) {
    form.updateFieldAppearances();
  } else {
    doc.registerFontkit(fontkit);
    form.updateFieldAppearances(await doc.embedFont(files.regular, { subset: true }));
  }

  // XFA would override what's shown in readers that support it; the AcroForm is now the truth.
  form.deleteXFA();
  if (options.flatten) {
    form.flatten({ updateFieldAppearances: false });
    doc.catalog.delete(PDFName.of("AcroForm"));
  } else {
    // The appearances are up to date; readers needn't rebuild them (and might, differently).
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), doc.context.obj(false));
  }
  return savePdf(doc);
}

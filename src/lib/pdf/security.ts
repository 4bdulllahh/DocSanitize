import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { ProcessingError } from "../errors";
import { collectGarbage, loadPdf, savePdf } from "./load";

export interface ProtectOptions {
  /** Needed to open the document. */
  userPassword: string;
  /** Needed to lift the restrictions below. A random one is used when empty. */
  ownerPassword?: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowModifying: boolean;
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypt with AES-256 (PDF 2.0's standard security handler, /V 5 /R 6).
 *
 * savePdf writes object streams, and that matters here: @cantoo/pdf-lib only encrypts streams, so a
 * string in a plain indirect object (title, author, link, form value) would stay readable. Inside
 * an object stream, it's encrypted along with the stream.
 */
export async function protectPdf(bytes: Uint8Array, options: ProtectOptions): Promise<Uint8Array> {
  if (!options.userPassword) throw new ProcessingError("Choose a password.", "invalid");
  const doc = await loadPdf(bytes);
  doc.encrypt({
    algorithm: "AES-256",
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword || randomPassword(),
    permissions: {
      printing: options.allowPrinting ? "highResolution" : false,
      copying: options.allowCopying,
      modifying: options.allowModifying,
      annotating: options.allowModifying,
      fillingForms: options.allowModifying,
      documentAssembly: options.allowModifying,
      // Screen readers keep working either way.
      contentAccessibility: true,
    },
  });
  const output = await savePdf(doc);
  // Prove the result opens with the password before handing it over.
  try {
    await PDFDocument.load(output, { password: options.userPassword, updateMetadata: false });
  } catch {
    throw new ProcessingError("Encrypting this PDF failed. Your file was not changed.", "corrupt");
  }
  return output;
}

export interface EncryptionInfo {
  encrypted: boolean;
  /** A password is needed just to open it (otherwise only an owner password restricts use). */
  needsPassword: boolean;
  /** e.g. "AES-256" or "RC4 40-bit". */
  algorithm: string;
  /** What the document forbids, in plain words. */
  restrictions: string[];
}

function describeAlgorithm(encrypt: PDFDict): string {
  const num = (key: string) => (encrypt.lookup(PDFName.of(key)) as PDFNumber | undefined)?.asNumber();
  const v = num("V") ?? 0;
  if (v >= 5) return "AES-256";
  if (v === 4) {
    const filters = encrypt.lookup(PDFName.of("CF"));
    const stdCF = filters instanceof PDFDict ? filters.lookup(PDFName.of("StdCF")) : undefined;
    const method = stdCF instanceof PDFDict ? stdCF.lookup(PDFName.of("CFM")) : undefined;
    return method === PDFName.of("AESV2") ? "AES-128" : "RC4 128-bit";
  }
  return v === 1 ? "RC4 40-bit" : `RC4 ${num("Length") ?? 40}-bit`;
}

function describeRestrictions(encrypt: PDFDict): string[] {
  const p = (encrypt.lookup(PDFName.of("P")) as PDFNumber | undefined)?.asNumber() ?? -1;
  const allowed = (bit: number) => (p & (1 << (bit - 1))) !== 0;
  const restrictions: string[] = [];
  if (!allowed(3)) restrictions.push("printing");
  if (!allowed(4)) restrictions.push("editing");
  if (!allowed(5)) restrictions.push("copying text and images");
  if (!allowed(6)) restrictions.push("adding comments");
  return restrictions;
}

/** Read the file without decrypting it: is it encrypted, and does opening it need a password? */
export async function inspectEncryption(bytes: Uint8Array): Promise<EncryptionInfo> {
  let raw: PDFDocument;
  try {
    raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw new ProcessingError("This file couldn't be read as a PDF.", "corrupt");
  }
  const encrypt = raw.context.lookup(raw.context.trailerInfo.Encrypt);
  if (!(encrypt instanceof PDFDict)) return { encrypted: false, needsPassword: false, algorithm: "", restrictions: [] };
  let needsPassword = false;
  try {
    await PDFDocument.load(bytes, { password: "", updateMetadata: false });
  } catch {
    needsPassword = true;
  }
  return { encrypted: true, needsPassword, algorithm: describeAlgorithm(encrypt), restrictions: describeRestrictions(encrypt) };
}

/** Decrypt with the open or owner password (none for restriction-only files) and save without encryption. */
export async function unlockPdf(bytes: Uint8Array, password = ""): Promise<Uint8Array> {
  const info = await inspectEncryption(bytes);
  if (!info.encrypted) throw new ProcessingError("This PDF isn't password-protected.", "invalid");

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { password, updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.message)) {
      throw new ProcessingError(password ? "That password isn't right." : "This PDF needs its password to open.", "encrypted");
    }
    throw new ProcessingError("This PDF couldn't be decrypted. It may be damaged or use an unsupported security handler.", "unsupported");
  }

  // Files with a cross-reference stream keep Info/ID in that stream's dictionary, which the
  // decrypting parser doesn't carry over. Object numbers are the same, so take them from a raw read.
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const { trailerInfo } = doc.context;
  trailerInfo.Info ??= raw.context.trailerInfo.Info;
  if (!trailerInfo.ID && raw.context.trailerInfo.ID instanceof PDFArray) trailerInfo.ID = raw.context.trailerInfo.ID.clone(doc.context);
  trailerInfo.Encrypt = undefined;

  // Drops the old cross-reference stream (which still names the /Encrypt dictionary) and the dictionary itself.
  collectGarbage(doc);
  return savePdf(doc);
}

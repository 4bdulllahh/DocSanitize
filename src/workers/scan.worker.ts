/// <reference lib="webworker" />
import { checkFile } from "@/lib/scan/filetype";
import { hashAll } from "@/lib/scan/hash";
import { inspectImage } from "@/lib/scan/image-forensics";
import { cleanOffice, inspectOffice } from "@/lib/scan/office-inspect";
import { cleanPdf, inspectPdf } from "@/lib/scan/pdf-inspect";
import { exposeWorkerApi } from "@/lib/worker-rpc";

const api = {
  inspectPdf,
  cleanPdf,
  inspectOffice,
  cleanOffice,
  inspectImage,
  checkFile,
  hashAll,
};
export type ScanWorkerApi = typeof api;

exposeWorkerApi(api);

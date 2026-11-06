// Offline lyrics translation: runs Bergamot (bergamot-translator.js and the engine from src-tauri/src/translate.rs)
// with Mozilla's models, off the page's thread. Set up as Firefox's own translations worker does
// (toolkit/components/translations/content/translations-engine.worker.js, MPL-2.0).
//
// In:  { id, wasm, models: [{ from, to, model, lex, vocab } or { ..., srcvocab, trgvocab }], lines }  (one model, or two through English)
// Out: { id, lines } with one translation per line, or { id, error }
/* global loadBergamot */
importScripts("bergamot-translator.js");

const ALIGN = { model: 256, lex: 64, vocab: 64, srcvocab: 64, trgvocab: 64 };
let bergamot = null;
const loaded = new Map();

function engine(wasmBinary) {
  if (bergamot) return Promise.resolve(bergamot);
  return new Promise((resolve, reject) => {
    const module = loadBergamot({
      wasmBinary,
      print: () => {},
      printErr: () => {},
      onAbort: () => reject(new Error("engine aborted")),
      onRuntimeInitialized: () => resolve((bergamot = module)),
    });
  });
}

function model(b, m) {
  const key = `${m.from}-${m.to}`;
  if (loaded.has(key)) return loaded.get(key);
  const mem = {};
  for (const kind of ["model", "lex", "vocab", "srcvocab", "trgvocab"]) {
    if (!m[kind]) continue;
    const bytes = new Uint8Array(m[kind]);
    mem[kind] = new b.AlignedMemory(bytes.byteLength, ALIGN[kind]);
    mem[kind].getByteArrayView().set(bytes);
  }
  const vocabs = new b.AlignedMemoryList();
  // One shared vocabulary, or one for each side.
  if (mem.vocab) vocabs.push_back(mem.vocab);
  else {
    vocabs.push_back(mem.srcvocab);
    vocabs.push_back(mem.trgvocab);
  }
  const config = Object.entries({
    "beam-size": "1",
    normalize: "1.0",
    "word-penalty": "0",
    "max-length-break": "128",
    "mini-batch-words": "1024",
    workspace: "128",
    "max-length-factor": "2.0",
    "skip-cost": "true",
    "cpu-threads": "0",
    quiet: "true",
    "quiet-translation": "true",
    "gemm-precision": "int8shiftAlphaAll",
    alignment: "soft",
  })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const translation = new b.TranslationModel(m.from, m.to, `\n${config}\n`, mem.model, mem.lex, vocabs, null);
  loaded.set(key, translation);
  return translation;
}

self.onmessage = async ({ data }) => {
  const { id, wasm, models, lines } = data;
  try {
    const b = await engine(wasm);
    const chain = models.map((m) => model(b, m));
    const messages = new b.VectorString();
    const options = new b.VectorResponseOptions();
    for (const line of lines) {
      messages.push_back(line);
      options.push_back({ qualityScores: false, alignment: false, html: false });
    }
    const service = new b.BlockingService({ cacheSize: 0 });
    const responses = chain.length === 1 ? service.translate(chain[0], messages, options) : service.translateViaPivoting(chain[0], chain[1], messages, options);
    const out = [];
    for (let i = 0; i < responses.size(); i++) out.push(responses.get(i).getTranslatedText());
    messages.delete();
    options.delete();
    responses.delete();
    service.delete();
    self.postMessage({ id, lines: out });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};

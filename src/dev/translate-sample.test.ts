import assert from "node:assert/strict";
import test from "node:test";
import { translateSample } from "./translate-sample.ts";

const SENTENCE = "Mañana tengo una reunión a las diez. ¿Puedes enviarme el informe antes?";

test("the demo translates its known sentence, Spanish to English", () => {
  assert.deepEqual(translateSample([["es", "en"]], [SENTENCE]), ["I have a meeting at ten tomorrow. Can you send me the report before then?"]);
});

test("any other text, or another way, stays app only", () => {
  assert.throws(() => translateSample([["es", "en"]], ["Hola, ¿qué tal?"]), /app only/);
  assert.throws(() => translateSample([["es", "en"]], [SENTENCE, "Otra línea"]), /app only/);
  assert.throws(() => translateSample([["es", "en"], ["en", "de"]], [SENTENCE]), /app only/);
});

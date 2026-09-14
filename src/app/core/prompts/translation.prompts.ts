import { LanguageInput, RenderedPrompt } from './prompt-inputs';

export type TranslateNoteInputs = LanguageInput & {
  /** The note exactly as it was stored, in whatever script it was written in. */
  text: string;
};

/**
 * Show a stored note in the language the app is being read in.
 *
 * A reproduction, not a rendition. A receipt note is a list of lines, and a
 * model asked to translate one without being told otherwise writes the gist of
 * it: fluent, shorter, and missing the third item. Figures cross unchanged for
 * the same reason — every amount, date and code is copied out exactly as
 * written rather than translated, because a reformatted amount or a converted
 * date is a different fact rather than the same fact in another language, and
 * the reader has no way to tell the two apart.
 *
 * The target language is named by the sentence every other user-facing prompt
 * already uses, rather than by a list of the languages the app can translate
 * into: such a list would be a ceiling on the app's own locales, and it would
 * have to be extended in this file every time one was added.
 *
 * `sourceLanguage` comes back named in the *target* language because it is
 * shown to the person reading the translation, who by construction reads that
 * one — "Japanese" under an English UI, not "日本語".
 */
export function renderTranslateNote(i: TranslateNoteInputs): RenderedPrompt {
  return {
    user: `You are translating a note a person saved with one of their own transactions.

NOTE:
${i.text}

INSTRUCTION: Translate the note into the language named below, reproducing it rather than retelling it.
${i.languageInstruction}
- Reproduce every line, in the order it was written. Never summarise, merge, omit or add a line.
- Keep numbers, currency symbols, dates and codes exactly as written.
- Translate the note and nothing else: no commentary, no explanation, no notes of your own.

Answer with ONLY this JSON object:
{"translation": "the whole note, translated, line breaks kept", "sourceLanguage": "the language the note was written in, named in the language you translated into"}`,
    expects: 'json',
    maxOutputTokens: 4096,
    temperature: 0,
  };
}

/**
 * Show a photographed receipt in the language the app is being read in.
 *
 * Takes no image: like every receipt prompt, the photo travels to the model
 * on the vision transport that attaches it, never as text embedded here.
 * This prompt is only the instruction that goes along with it.
 *
 * A reproduction, not a rendition, for the same reason `renderTranslateNote`
 * is one: a model asked to translate a receipt without being told otherwise
 * writes the gist of it — fluent, shorter, and missing the third line. A
 * receipt is lines in order, so every line printed on it is transcribed and
 * translated, none summarised, merged, omitted or added. Figures cross
 * unchanged for the same reason — every amount, date and code is copied out
 * exactly as printed rather than translated, because a reformatted amount or
 * a converted date is a different fact rather than the same fact in another
 * language, and the reader has no way to tell the two apart.
 *
 * The target language is named by the sentence every other user-facing prompt
 * already uses, rather than by a list of the languages the app can translate
 * into: such a list would be a ceiling on the app's own locales, and it would
 * have to be extended in this file every time one was added.
 *
 * `sourceLanguage` comes back named in the *target* language because it is
 * shown to the person reading the translation, who by construction reads that
 * one — "Japanese" under an English UI, not "日本語".
 */
export function renderTranslateReceiptImage(i: LanguageInput): RenderedPrompt {
  return {
    user: `You are translating a photo of a receipt into the language named below.

INSTRUCTION: Transcribe every line printed on the receipt, in the order it is printed, and translate each one into the language named below. Reproduce the receipt rather than retelling it.
${i.languageInstruction}
- Reproduce every line, in the order it is printed. Never summarise, merge, omit or add a line.
- Keep numbers, currency symbols, dates and codes exactly as printed.
- Translate the receipt and nothing else: no commentary, no explanation, no notes of your own.

Answer with ONLY this JSON object:
{"translation": "the whole receipt, translated, line breaks kept", "sourceLanguage": "the language the receipt was printed in, named in the language you translated into"}`,
    expects: 'json',
    maxOutputTokens: 4096,
    temperature: 0,
  };
}

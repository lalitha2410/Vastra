/**
 * formatText.ts turns the model's stray markdown into WhatsApp's
 * *single-asterisk* bold convention for on-screen rendering. Voice has no
 * such convention to render TOWARD — there's nothing visual to fix. The
 * failure mode here is different: the model doesn't follow the "no
 * markdown" instruction in voiceSystemPrompt.ts with 100% consistency, and
 * a stray "**" or "#" handed straight to speechSynthesis gets read aloud
 * as literal punctuation ("asterisk asterisk") instead of silently
 * dropped. This strips the same handful of symbols before both the
 * transcript display and the SpeechSynthesisUtterance text, so a
 * formatting slip never becomes an audible glitch. Same principle as the
 * policy engine (src/lib/policy.ts): the model converses, code enforces.
 */
export function sanitizeSpeechText(text: string): string {
  return text
    .replace(/\*{1,3}(.+?)\*{1,3}/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`+/g, '')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

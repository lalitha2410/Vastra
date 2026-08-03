/**
 * The system prompt asks the model to use WhatsApp's *single-asterisk*
 * bold convention instead of markdown's **double-asterisk** — but a small
 * model doesn't follow formatting instructions with 100% consistency, and
 * ChatBubble renders plain text with no markdown parser, so any stray
 * markdown shows up literally on screen. Same principle as the policy
 * engine (src/lib/policy.ts): the model converses, code enforces.
 *
 * Three passes, in order, each fixing a case the previous version (a
 * single lazy double-asterisk pair match, no dotAll flag) missed —
 * verified against real ticket-confirmation output, not just reasoned
 * about:
 *
 * 1. A line-leading "* " is a markdown list bullet, not emphasis —
 *    collapse it to a plain bullet first. Otherwise a bulleted, bolded
 *    label like "* **Ticket ID:**" becomes "* *Ticket ID:*" after the
 *    bold pass: a bullet asterisk sitting right next to an emphasis
 *    asterisk, which reads as a run of stray stars even though each one
 *    is individually "correct".
 * 2. Collapse a run of 3+ asterisks (markdown's bold-italic combo) down to
 *    a plain pair first. The old regex left these half-converted — the
 *    outer pair got consumed but a literal double-asterisk was left over,
 *    never touched again.
 * 3. Collapse double-asterisk pairs to single, now matching across line
 *    breaks. Previously, a bold span whose closing marker landed on a
 *    later line (the model wrapping a whole multi-line block in one bold
 *    run) never matched at all — both markers stayed literal on screen.
 *    The match is still lazy, so well-formed same-line pairs are
 *    unaffected; this only adds the ability to close spans that would
 *    otherwise never resolve.
 */
export function sanitizeWhatsAppText(text: string): string {
  return text
    .replace(/^[ \t]*\*[ \t]+/gm, '• ')
    .replace(/\*{3,}/g, '**')
    .replace(/\*\*(.+?)\*\*/gs, '*$1*');
}

export interface TextSegment {
  bold: boolean;
  text: string;
}

/**
 * Sanitizes, then splits into plain/bold segments for the renderer to turn
 * into text nodes and <strong> — sanitizing alone only normalizes *which*
 * asterisks are left in the string, it doesn't make WhatsApp's convention
 * actually render as bold, so the previous version showed literal `*S*`
 * on screen. This is the part that makes it real formatting.
 *
 * A single asterisk is only treated as an emphasis marker when it opens
 * and closes on the *same* line with plain text in between (no nested
 * asterisk, no crossing a newline) — deliberately narrow so it can't
 * misfire on the numbered-emoji list style (1️⃣ 2️⃣ 3️⃣) or on an unpaired
 * asterisk left over from something the sanitizer didn't recognize; those
 * just fall through as plain text, unchanged.
 */
export function parseWhatsAppText(rawText: string): TextSegment[] {
  const text = sanitizeWhatsAppText(rawText);
  const segments: TextSegment[] = [];
  const boldPattern = /\*([^\n*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ bold: false, text: text.slice(lastIndex, match.index) });
    }
    segments.push({ bold: true, text: match[1] });
    lastIndex = boldPattern.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ bold: false, text: text.slice(lastIndex) });
  }
  return segments;
}

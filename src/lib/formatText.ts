/**
 * The system prompt asks the model to use WhatsApp's *single-asterisk*
 * bold convention instead of markdown's **double-asterisk** — but a small
 * model doesn't follow formatting instructions with 100% consistency, and
 * ChatBubble renders plain text with no markdown parser, so any stray
 * ** shows up literally on screen. Same principle as the policy engine
 * (src/lib/policy.ts): the model converses, code enforces. This collapses
 * **bold** down to WhatsApp's *bold* before it ever reaches the screen,
 * regardless of what the model actually emitted.
 */
export function sanitizeWhatsAppText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
}

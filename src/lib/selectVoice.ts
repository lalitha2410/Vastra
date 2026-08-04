import type { VoiceSettings } from '../config/brand';

export interface VoiceSelection {
  voice: SpeechSynthesisVoice | null;
  label: string;
}

/**
 * Ranks the browser's installed speechSynthesis voices against the brand's
 * wishlist (see VoiceSettings) and picks one. Which voices exist is entirely
 * OS/browser dependent — Edge on Windows ships several Indian English
 * voices (Neerja etc.), Chrome's selection varies by platform, Firefox
 * often has none — so this degrades through three tiers rather than
 * assuming a specific voice exists: exact lang+name-hint match, then just
 * lang match, then any English voice, then whatever the browser defaults
 * to (voice left null — speechSynthesis still speaks, just unstyled).
 */
export function selectAgentVoice(voices: SpeechSynthesisVoice[], settings: VoiceSettings): VoiceSelection {
  if (voices.length === 0) {
    return { voice: null, label: 'Browser default (voice list not loaded yet)' };
  }

  for (const prefix of settings.langPrefixes) {
    const inLang = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix.toLowerCase()));
    if (inLang.length === 0) continue;

    const hinted = inLang.find((v) =>
      settings.nameHints.some((hint) => v.name.toLowerCase().includes(hint.toLowerCase())),
    );
    if (hinted) return { voice: hinted, label: `${hinted.name} (${hinted.lang})` };

    return { voice: inLang[0], label: `${inLang[0].name} (${inLang[0].lang})` };
  }

  const anyEnglish = voices.find((v) => v.lang.toLowerCase().startsWith('en'));
  if (anyEnglish) return { voice: anyEnglish, label: `${anyEnglish.name} (${anyEnglish.lang})` };

  return { voice: voices[0], label: `${voices[0].name} (${voices[0].lang})` };
}

import type { Order } from '../types';
import { orders } from '../data/orders';
import { pharmacyOrders } from '../data/pharmacyOrders';

export interface BrandColors {
  /** Main brand colour — WhatsApp-style sent bubble, ops accent, buttons. */
  primary: string;
  primaryDark: string;
  /** Light tint used for subtle backgrounds/badges. */
  tint: string;
}

/** Speech-synthesis preferences for the agent's voice. `langPrefixes` and
 * `nameHints` are tried in order against the browser's actual voice list
 * (see hooks/useSpeechSynthesis.ts) — which voices are installed varies by
 * OS/browser, so this is a ranked wishlist, not a guarantee. */
export interface VoiceSettings {
  langPrefixes: string[];
  nameHints: string[];
  rate: number;
  pitch: number;
}

export interface BrandConfig {
  id: string;
  name: string;
  vertical: string;
  /** Short text mark rendered in place of a real logo image. */
  logoMark: string;
  colors: BrandColors;
  agentName: string;
  /** Free-text tone description injected into the agent's system instruction. */
  tone: string;
  voice: VoiceSettings;
  returnWindowDays: number;
  waNumber: string;
  /** Displayed in the voice channel's call header — the "line" the customer
   * is calling, as distinct from the WhatsApp number the chat channel shows.
   * Same brand, same agent, two separate contact numbers, same as most
   * real D2C support setups. */
  supportNumber: string;
  catalog: Order[];
}

export const vastraBrand: BrandConfig = {
  id: 'vastra',
  name: 'Vastra',
  vertical: 'Fashion & Apparel',
  logoMark: 'V',
  colors: {
    primary: '#B45320',
    primaryDark: '#8A3F17',
    tint: '#FBEFE6',
  },
  agentName: 'Riya',
  tone:
    'warm, upbeat, and conversational — like a helpful store associate. ' +
    'Use short, friendly sentences. Never sound scripted or robotic.',
  voice: {
    // Ranked preference: a female Indian-English voice first, then any
    // Indian-English voice, then any English voice at all.
    langPrefixes: ['en-IN', 'en-GB', 'en-US', 'en'],
    nameHints: ['india', 'indian', 'veena', 'raveena', 'lekha', 'female'],
    rate: 1.0,
    pitch: 1.05,
  },
  returnWindowDays: 7,
  waNumber: '+91 98450 12345',
  supportNumber: '+91 98450 12345',
  catalog: orders,
};

export const pharmacyBrand: BrandConfig = {
  id: 'wellnest',
  name: 'WellNest Pharmacy',
  vertical: 'Pharmacy & Healthcare',
  logoMark: '+',
  colors: {
    primary: '#1E6F5C',
    primaryDark: '#134A3D',
    tint: '#E7F3EF',
  },
  agentName: 'Aarav',
  tone:
    'calm, precise, and reassuring — like a pharmacist\'s assistant. Keep language clear and unambiguous, ' +
    'avoid casual slang, and be extra careful to state safety/regulatory reasons when a medicine ' +
    'return is refused (e.g. medicines cannot be returned once dispensed, except for damaged/wrong items).',
  voice: {
    // Ranked preference: a male Indian-English voice first, then any
    // Indian-English voice, then any English voice at all — distinct from
    // Riya's, matching Aarav's implied gender and calmer, measured tone.
    langPrefixes: ['en-IN', 'en-GB', 'en-US', 'en'],
    nameHints: ['ravi', 'prabhat', 'india', 'indian', 'male'],
    rate: 0.95,
    pitch: 0.95,
  },
  returnWindowDays: 2,
  waNumber: '+91 98450 67890',
  supportNumber: '+91 98450 67890',
  catalog: pharmacyOrders,
};

export const brands: BrandConfig[] = [vastraBrand, pharmacyBrand];

export function getBrandById(id: string): BrandConfig {
  return brands.find((b) => b.id === id) ?? brands[0];
}

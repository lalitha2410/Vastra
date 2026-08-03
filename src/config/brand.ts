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
  returnWindowDays: number;
  waNumber: string;
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
    'warm, upbeat, and conversational — like a helpful store associate texting on WhatsApp. ' +
    'Use short, friendly sentences and the occasional emoji (max one per message). Never sound scripted or robotic.',
  returnWindowDays: 7,
  waNumber: '+91 98450 12345',
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
    'avoid casual slang and emojis, and be extra careful to state safety/regulatory reasons when a medicine ' +
    'return is refused (e.g. medicines cannot be returned once dispensed, except for damaged/wrong items).',
  returnWindowDays: 2,
  waNumber: '+91 98450 67890',
  catalog: pharmacyOrders,
};

export const brands: BrandConfig[] = [vastraBrand, pharmacyBrand];

export function getBrandById(id: string): BrandConfig {
  return brands.find((b) => b.id === id) ?? brands[0];
}

export interface Scenario {
  id: string;
  label: string;
  message: string;
}

/**
 * Scripted openers for "Play scenario" — lets a live demo run without typing.
 * Each references a specific seeded order so the outcome is deterministic.
 */
const scenariosByBrand: Record<string, Scenario[]> = {
  vastra: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      message:
        "Hi! I got my order VS1001 yesterday but the kurta runs really tight — can I exchange it for a bigger size?",
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      message: "Hi, I'd like to return the shirt from order VS1004. It's just not really my style.",
    },
    {
      id: 'final_sale',
      label: 'Final sale item',
      message: "Hi, I want to return the gown from order VS1007 — turns out I don't need it after all.",
    },
  ],
  wellnest: [
    {
      id: 'size_exchange',
      label: 'Size issue → exchange',
      message:
        'Hi, I ordered order WN2007 but the knee support is too loose on me — could I exchange it for a smaller size?',
    },
    {
      id: 'outside_window',
      label: 'Outside return window',
      message: "Hi, I want to return the weighing scale from order WN2004, it's not reading accurately.",
    },
    {
      id: 'final_sale',
      label: 'Final sale item',
      message: "Hi, I'd like to return the Amoxicillin strip from order WN2002, I no longer need it.",
    },
  ],
};

export function getScenarios(brandId: string): Scenario[] {
  return scenariosByBrand[brandId] ?? [];
}

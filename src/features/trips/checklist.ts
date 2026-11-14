export type ChecklistCategory = "documents" | "safety" | "motorcycle" | "touring" | "essentials";
export type ChecklistStatus = "needed" | "owned" | "packed" | "not_applicable";
export type Terrain = "plains" | "hills" | "mountains" | "desert";
export type Season = "summer" | "monsoon" | "winter";

export const CATEGORY_ORDER: ChecklistCategory[] = ["documents", "safety", "motorcycle", "touring", "essentials"];

export const CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  documents: "Documents",
  safety: "Safety gear",
  motorcycle: "Motorcycle",
  touring: "Touring",
  essentials: "Essentials",
};

export const STATUS_LABEL: Record<ChecklistStatus, string> = {
  needed: "Need it",
  owned: "Have it",
  packed: "Packed",
  not_applicable: "N/A",
};

export interface TripProfile {
  days?: number | null;
  terrain?: Terrain | null;
  season?: Season | null;
}

interface Rule {
  terrain?: Terrain[];
  season?: Season[];
  minDays?: number;
  maxDays?: number;
}

interface TemplateItem {
  category: ChecklistCategory;
  label: string;
  when?: Rule;
  /** Safety-critical gear is never offered second-hand (see marketplace policy). */
  gear?: boolean;
}

// A starting list for long rides in India. Items marked with `when` only appear for matching trips.
// It is a prompt for the rider, not legal or safety advice.
const TEMPLATE: TemplateItem[] = [
  // Documents
  { category: "documents", label: "Driving licence" },
  { category: "documents", label: "Registration certificate (RC)" },
  { category: "documents", label: "Valid insurance" },
  { category: "documents", label: "Valid PUC certificate" },
  { category: "documents", label: "ID proof and a few photocopies" },
  { category: "documents", label: "Permits or entry passes for restricted areas (check official sources)", when: { terrain: ["mountains"] } },

  // Safety gear
  { category: "safety", label: "ISI/ECE helmet with a clear visor", gear: true },
  { category: "safety", label: "Riding gloves", gear: true },
  { category: "safety", label: "Riding jacket with armour", gear: true },
  { category: "safety", label: "Riding boots", gear: true },
  { category: "safety", label: "Knee guards", gear: true },
  { category: "safety", label: "Thermal innerwear and a windproof layer", when: { season: ["winter"] } },
  { category: "safety", label: "Thermal or waterproof gloves", when: { season: ["winter", "monsoon"], terrain: ["mountains", "hills"] } },

  // Motorcycle
  { category: "motorcycle", label: "Engine oil level and service due checked" },
  { category: "motorcycle", label: "Chain cleaned, lubed and tension checked" },
  { category: "motorcycle", label: "Tyre pressure and tread checked" },
  { category: "motorcycle", label: "Brakes and brake fluid checked" },
  { category: "motorcycle", label: "Lights, indicators and horn working" },
  { category: "motorcycle", label: "Fuel tank full before the start" },
  { category: "motorcycle", label: "Brake pads and clutch cable checked for long descents", when: { terrain: ["mountains", "hills"] } },
  { category: "motorcycle", label: "Air filter cleaned or replaced for dust", when: { terrain: ["desert"] } },
  { category: "motorcycle", label: "Good tread on tyres for wet roads", when: { season: ["monsoon"] } },

  // Touring
  { category: "touring", label: "Saddlebags or tail bag with secure straps" },
  { category: "touring", label: "Raincoat or rain suit", when: { season: ["monsoon"] } },
  { category: "touring", label: "Waterproof liner or cover for luggage", when: { season: ["monsoon"] } },
  { category: "touring", label: "Puncture repair kit and tyre inflator" },
  { category: "touring", label: "Basic tool kit" },
  { category: "touring", label: "Spare bulbs, fuses and zip ties", when: { minDays: 2 } },
  { category: "touring", label: "Spare tube and clutch/brake levers", when: { terrain: ["mountains", "desert"] } },
  { category: "touring", label: "Bungee cords and a lock for the luggage", when: { minDays: 3 } },

  // Essentials
  { category: "essentials", label: "First-aid kit" },
  { category: "essentials", label: "Personal medicines" },
  { category: "essentials", label: "Power bank, phone mount and charging cable" },
  { category: "essentials", label: "Water bottle and some cash (UPI can be patchy)" },
  { category: "essentials", label: "Emergency contact and offline map saved" },
  { category: "essentials", label: "Extra water or a hydration pack (2 litres or more)", when: { terrain: ["desert"] } },
  { category: "essentials", label: "Sunscreen and a cooling neck cover", when: { season: ["summer"] } },
  { category: "essentials", label: "Ask a doctor about altitude precautions before high passes", when: { terrain: ["mountains"] } },
  { category: "essentials", label: "Stay booked, or a backup plan for each night", when: { minDays: 2 } },
];

function matches(rule: Rule | undefined, p: TripProfile): boolean {
  if (!rule) return true;
  // A rule with several conditions applies when ANY condition matches (they are alternatives, e.g. winter OR hills).
  // Unknown profile fields never trigger a rule, so a rider who has not set them still gets the core list.
  const checks: boolean[] = [];
  if (rule.terrain) checks.push(p.terrain != null && rule.terrain.includes(p.terrain));
  if (rule.season) checks.push(p.season != null && rule.season.includes(p.season));
  if (rule.minDays != null) checks.push(p.days != null && p.days >= rule.minDays);
  if (rule.maxDays != null) checks.push(p.days != null && p.days <= rule.maxDays);
  return checks.some(Boolean);
}

export interface ChecklistTemplateItem {
  category: ChecklistCategory;
  label: string;
  sortOrder: number;
  gear: boolean;
}

/** Suggested checklist for a trip. Same profile always gives the same list, in a stable order. */
export function buildChecklist(profile: TripProfile = {}): ChecklistTemplateItem[] {
  const picked = TEMPLATE.filter((t) => matches(t.when, profile));
  const out: ChecklistTemplateItem[] = [];
  for (const category of CATEGORY_ORDER) {
    for (const t of picked.filter((x) => x.category === category)) {
      out.push({ category, label: t.label, sortOrder: out.length, gear: Boolean(t.gear) });
    }
  }
  return out;
}

/** An item counts as ready once it is packed, or does not apply to this trip. */
export function isReady(status: ChecklistStatus): boolean {
  return status === "packed" || status === "not_applicable";
}

export function checklistProgress(items: { status: ChecklistStatus }[]): { ready: number; total: number; percent: number; stillNeeded: number } {
  const total = items.length;
  const ready = items.filter((i) => isReady(i.status)).length;
  return {
    ready,
    total,
    percent: total === 0 ? 0 : Math.round((ready / total) * 100),
    stillNeeded: items.filter((i) => i.status === "needed").length,
  };
}

/** Labels of safety-gear items the rider still needs: these are what the future marketplace would help with. */
export function gearStillNeeded(items: { label: string; status: ChecklistStatus }[]): string[] {
  const gearLabels = new Set(TEMPLATE.filter((t) => t.gear).map((t) => t.label));
  return items.filter((i) => i.status === "needed" && gearLabels.has(i.label)).map((i) => i.label);
}

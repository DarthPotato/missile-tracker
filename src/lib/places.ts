// Where things happened, for the map. Live posts and claims name places in
// free text ("Strait of Hormuz", "Over Iran", "Saudi-led coalition"); this
// turns the ones we know into a point. Anything it can't place stays off the
// map and is listed under it instead, never guessed.
import { THREAT_LABEL, type LiveEvent } from "./live";
import type { DroneClaim } from "./drones";
import type { DronesFile } from "./schema";

export type LonLat = [number, number];

/** Place names, most specific first, with an approximate [longitude, latitude]. */
const PLACES: [RegExp, string, LonLat][] = [
  // Bases and cities
  [/prince sultan/i, "Prince Sultan Air Base", [47.58, 24.06]],
  [/al[\s-]udeid/i, "Al Udeid Air Base", [51.31, 25.12]],
  [/al[\s-]dhafra/i, "Al Dhafra Air Base", [54.55, 24.25]],
  [/ali al[\s-]salem/i, "Ali Al Salem Air Base", [47.52, 29.35]],
  [/riyadh/i, "Riyadh", [46.72, 24.69]],
  [/jeddah/i, "Jeddah", [39.19, 21.49]],
  [/tehran/i, "Tehran", [51.39, 35.69]],
  [/isfahan/i, "Isfahan", [51.67, 32.65]],
  [/bushehr/i, "Bushehr", [50.84, 28.97]],
  [/bandar abbas/i, "Bandar Abbas", [56.27, 27.18]],
  [/shiraz/i, "Shiraz", [52.53, 29.59]],
  [/tabriz/i, "Tabriz", [46.29, 38.08]],
  [/marib/i, "Marib", [45.32, 15.46]],
  [/sana'?a/i, "Sanaa", [44.21, 15.37]],
  [/hodeidah|hudaydah/i, "Hodeidah", [42.95, 14.8]],
  [/baghdad/i, "Baghdad", [44.37, 33.31]],
  [/erbil/i, "Erbil", [44.01, 36.19]],
  [/basra/i, "Basra", [47.78, 30.51]],
  [/dubai/i, "Dubai", [55.27, 25.2]],
  [/abu dhabi/i, "Abu Dhabi", [54.37, 24.45]],
  [/doha/i, "Doha", [51.53, 25.29]],
  [/manama/i, "Manama", [50.58, 26.23]],
  [/tel aviv/i, "Tel Aviv", [34.78, 32.09]],
  [/haifa/i, "Haifa", [34.99, 32.79]],
  // Waters
  [/strait of hormuz|hormuz/i, "Strait of Hormuz", [56.4, 26.6]],
  [/bab[\s-]el[\s-]mandeb|bab al[\s-]mandab/i, "Bab el-Mandeb", [43.3, 12.6]],
  [/gulf of aden/i, "Gulf of Aden", [48.0, 12.5]],
  [/gulf of oman/i, "Gulf of Oman", [58.5, 24.5]],
  [/red sea/i, "Red Sea", [38.5, 20.0]],
  [/arabian sea/i, "Arabian Sea", [62.0, 18.0]],
  [/persian gulf|arabian gulf|\bthe gulf\b/i, "Persian Gulf", [51.5, 27.0]],
  // Countries, last so a city or sea wins
  [/saudi/i, "Saudi Arabia", [45.0, 24.0]],
  [/united arab emirates|\buae\b|emirati/i, "United Arab Emirates", [54.3, 23.9]],
  [/bahrain/i, "Bahrain", [50.55, 26.07]],
  [/kuwait/i, "Kuwait", [47.6, 29.3]],
  [/qatar/i, "Qatar", [51.2, 25.3]],
  [/\boman\b/i, "Oman", [57.0, 21.0]],
  [/iraq/i, "Iraq", [43.7, 33.0]],
  [/\biran\b/i, "Iran", [53.7, 32.4]],
  [/israel/i, "Israel", [34.9, 31.4]],
  [/jordan/i, "Jordan", [36.5, 31.0]],
  [/yemen|houthi/i, "Yemen", [47.5, 15.6]],
  [/syria/i, "Syria", [38.5, 35.0]],
  [/lebanon/i, "Lebanon", [35.9, 33.9]],
];

/** The point a place name stands for, or undefined when we don't know it. */
export function locate(text: string | undefined): { name: string; at: LonLat } | undefined {
  if (!text) return undefined;
  for (const [re, name, at] of PLACES) if (re.test(text)) return { name, at };
  return undefined;
}

export type MarkKind = "intercept" | "jet-lost" | "claim";

export interface Mark {
  kind: MarkKind;
  place: string;
  at: LonLat;
  /** Intercepts: how many shot down. Losses and claims: how many aircraft. */
  count: number;
  /** How many events or claims this mark gathers. */
  events: number;
  /** One line per event, newest first. */
  lines: string[];
}

export interface MapData {
  marks: Mark[];
  /** Events and claims with no place we could pin, so the page can list them. */
  unplaced: string[];
}

function add(
  marks: Map<string, Mark>,
  kind: MarkKind,
  place: { name: string; at: LonLat },
  count: number,
  line: string,
) {
  const key = `${kind}|${place.name}`;
  const m = marks.get(key) ?? { kind, place: place.name, at: place.at, count: 0, events: 0, lines: [] };
  m.count += count;
  m.events += 1;
  m.lines.push(line);
  marks.set(key, m);
}

/**
 * Map marks for the Middle East: intercepts by the country that reported them,
 * confirmed U.S. jet losses where they happened, and Iranian and Houthi
 * shoot-down claims where they say. Ukraine is a different map.
 */
export function mapData(events: LiveEvent[], jets: DronesFile["jets"], claims: DroneClaim[]): MapData {
  const marks = new Map<string, Mark>();
  const unplaced: string[] = [];
  for (const e of [...events].sort((a, b) => b.date.localeCompare(a.date))) {
    if (e.theater === "ukraine") continue;
    const n = Math.max(0, ...e.sources.map((s) => s.intercepted ?? 0));
    const label = n === 1 && e.threat !== "mixed" ? THREAT_LABEL[e.threat].replace(/s$/, "") : THREAT_LABEL[e.threat];
    const line = `${e.date}: ${e.defender}, ${n || "some"} ${label} intercepted`;
    // The defender first; else a place in the quotes, leaving out where the attack came from
    // ("two Iranian drones heading towards Bahrain" is Bahrain, not Iran).
    const quotes = e.sources
      .map((s) => s.quote)
      .join(" ")
      .replace(/\b(iran(ian)?|houthis?|yemeni?)\b/gi, "");
    const place = locate(e.defender) ?? locate(quotes);
    if (place) add(marks, "intercept", place, n, line);
    else unplaced.push(line);
  }
  for (const l of [...jets.losses].sort((a, b) => b.date.localeCompare(a.date))) {
    if (l.cause === "damaged") continue;
    const line = `${l.date}: ${l.count > 1 ? `${l.count} ${l.model}s` : `${l.model}`} ${
      l.cause === "friendly-fire" ? "downed by friendly fire" : "shot down"
    }`;
    const place = locate(l.place);
    if (place) add(marks, "jet-lost", place, l.count, line);
    else unplaced.push(line);
  }
  for (const c of [...claims].sort((a, b) => b.date.localeCompare(a.date))) {
    const what = c.aircraft === "jet" ? (c.model ?? "jet") : c.aircraft === "mq9" ? "MQ-9" : "MQ-1";
    const line = `${c.date}: ${c.claimant} claims ${c.count > 1 ? `${c.count} ${what}s` : `an ${what}`}`;
    const place = locate(c.place);
    if (place) add(marks, "claim", place, c.count, line);
    else unplaced.push(line);
  }
  return { marks: [...marks.values()], unplaced };
}

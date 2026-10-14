// Interactive rebuild projection. The page embeds the sourced defaults as
// JSON; this re-runs the same model the build uses whenever a control moves,
// then redraws an SVG line/band chart with a crosshair tooltip.
import { project, type ProjectionInput, type ProjectionResult } from "../lib/model";
import { formatDate, formatMonth } from "../lib/format";

export interface ChartConfig {
  name: string;
  today: string;
  prewar: number;
  start: ProjectionInput["start"];
  qualifier: string;
  deliveriesPerYear: { value: number; max: number };
  rebuild?: { quantity: number; begin: string; perYear: number };
  burnPerDay?: number;
  csisOutlook?: string;
  end: string;
  history: { date: string; low: number; high: number; label: string; qualifier: string }[];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

function niceMax(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function compact(n: number): string {
  return n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : nf.format(n);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(t(iso));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function mountProjection(root: HTMLElement) {
  const cfg: ChartConfig = JSON.parse(root.querySelector("script[type='application/json']")!.textContent!);
  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;

  const rate = $<HTMLInputElement>("[name=rate]");
  const rateOut = $<HTMLOutputElement>("output[for=rate]");
  const rebuildBox = root.querySelector<HTMLInputElement>("[name=rebuild]");
  const warDays = $<HTMLInputElement>("[name=warDays]");
  const warDaysOut = $<HTMLOutputElement>("output[for=warDays]");
  const warRate = root.querySelector<HTMLInputElement>("[name=warRate]");
  const warRateOut = root.querySelector<HTMLOutputElement>("output[for=warRate]");
  const warStart = $<HTMLSelectElement>("[name=warStart]");
  const svg = $<SVGSVGElement>("svg.chart");
  const tip = $<HTMLDivElement>(".tip");
  const readout = $<HTMLDivElement>(".readout");
  const tableBody = $<HTMLTableSectionElement>("table.proj tbody");

  let result: ProjectionResult;
  let input: ProjectionInput;

  function currentInput(): ProjectionInput {
    const days = Number(warDays.value);
    const perDay = warRate ? Number(warRate.value) : 0;
    return {
      start: cfg.start,
      prewar: cfg.prewar,
      deliveriesPerYear: Number(rate.value),
      rebuild: rebuildBox?.checked ? cfg.rebuild : undefined,
      war: days > 0 && perDay > 0 ? { start: addMonths(cfg.today, Number(warStart.value)), days, perDay } : undefined,
      end: cfg.end,
    };
  }

  function update() {
    rateOut.value = `${nf.format(Number(rate.value))} / yr`;
    warDaysOut.value = Number(warDays.value) === 0 ? "Off" : `${warDays.value} days`;
    if (warRate && warRateOut) warRateOut.value = `${nf.format(Number(warRate.value))} / day`;
    input = currentInput();
    result = project(input);
    renderReadout();
    renderChart();
    renderTable();
  }

  function range(a?: string, b?: string): string {
    if (!a && !b) return "Not by 2033";
    if (!a || !b || formatMonth(a) === formatMonth(b)) return formatMonth((a ?? b)!);
    return `${formatMonth(b)} – ${formatMonth(a)}`;
  }

  function renderReadout() {
    const items: [string, string, string?][] = [];
    items.push([
      "Back to prewar level",
      range(result.recovered.low, result.recovered.high),
      cfg.csisOutlook ? `CSIS's own estimate: ${cfg.csisOutlook}` : undefined,
    ]);
    if (input.war) {
      items.push([
        "Runs out during the renewed war",
        result.depleted.low ? `Day ${Math.round((t(result.depleted.low) - t(input.war.start)) / DAY) + 1}` : "No",
        result.shortfall > 0 ? `${nf.format(result.shortfall)} fewer than the war would need (low estimate)` : "Stock outlasts the scenario",
      ]);
    }
    readout.replaceChildren(
      ...items.map(([label, value, note]) => {
        const d = document.createElement("div");
        d.className = "card tile";
        const l = document.createElement("div");
        l.className = "tile-label";
        l.textContent = label;
        const v = document.createElement("div");
        v.className = "tile-value";
        v.textContent = value;
        d.append(l, v);
        if (note) {
          const n = document.createElement("div");
          n.className = "tile-note";
          n.textContent = note;
          d.append(n);
        }
        return d;
      }),
    );
  }

  // ---- chart ---------------------------------------------------------------
  const M = { top: 16, right: 16, bottom: 30, left: 44 };
  let xScale = (_ms: number) => 0;
  let yScale = (_v: number) => 0;

  function renderChart() {
    const width = Math.max(300, svg.clientWidth || 720);
    const height = width < 560 ? 280 : 340;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.replaceChildren();

    const x0 = t("2026-01-01");
    const x1 = t(cfg.end);
    // Scale to the prewar level and the estimates, not to post-recovery growth,
    // which would flatten the part of the story that matters. The line clips at the top.
    const ymax = niceMax(Math.max(cfg.prewar * 1.3, ...cfg.history.map((h) => h.high * 1.1)));
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    xScale = (ms) => M.left + ((ms - x0) / (x1 - x0)) * iw;
    yScale = (v) => M.top + ih - (v / ymax) * ih;

    // Grid + y ticks
    const g = el("g", { class: "grid" }, svg);
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (ymax / ticks) * i;
      el("line", { x1: M.left, x2: width - M.right, y1: yScale(v), y2: yScale(v), class: i === 0 ? "baseline" : "gridline" }, g);
      const tx = el("text", { x: M.left - 8, y: yScale(v) + 4, class: "tick", "text-anchor": "end" }, g);
      tx.textContent = compact(v);
    }
    // X ticks: years (every other year on narrow screens)
    const yearStep = width < 560 ? 2 : 1;
    for (let y = 2026; y <= Number(cfg.end.slice(0, 4)); y += yearStep) {
      const xs = xScale(t(`${y}-01-01`));
      const tx = el("text", { x: xs, y: height - 8, class: "tick", "text-anchor": y === 2026 ? "start" : "middle" }, g);
      tx.textContent = String(y);
      el("line", { x1: xs, x2: xs, y1: M.top + ih, y2: M.top + ih + 4, class: "baseline" }, g);
    }

    // Prewar reference
    const py = yScale(cfg.prewar);
    el("line", { x1: M.left, x2: width - M.right, y1: py, y2: py, class: "ref" }, svg);
    const pl = el("text", { x: width - M.right, y: py - 6, class: "ref-label", "text-anchor": "end" }, svg);
    pl.textContent = `Prewar ~${nf.format(cfg.prewar)}`;

    // War window
    if (input.war) {
      const wx0 = xScale(t(input.war.start));
      const wx1 = xScale(t(input.war.start) + input.war.days * DAY);
      el("rect", { x: wx0, y: M.top, width: Math.max(2, wx1 - wx0), height: ih, class: "war" }, svg);
      const wl = el("text", { x: wx0 + 4, y: M.top + 12, class: "war-label" }, svg);
      wl.textContent = "Renewed war";
    }

    // Today
    const tx = xScale(t(cfg.today));
    el("line", { x1: tx, x2: tx, y1: M.top, y2: M.top + ih, class: "today" }, svg);
    const tl = el("text", { x: tx + 4, y: M.top + ih - 6, class: "today-label" }, svg);
    tl.textContent = "Today";

    // Projection band + line (dashed: it's a projection, not a measurement)
    const pts = result.points;
    const clipId = `clip-${cfg.name.replace(/\W/g, "")}`;
    const clip = el("clipPath", { id: clipId }, el("defs", {}, svg));
    el("rect", { x: M.left, y: M.top, width: iw, height: ih }, clip);
    const projG = el("g", { "clip-path": `url(#${clipId})` }, svg);
    const upper = pts.map((p) => `${xScale(t(p.date))},${yScale(p.high)}`);
    const lower = pts.map((p) => `${xScale(t(p.date))},${yScale(p.low)}`).reverse();
    el("polygon", { points: [...upper, ...lower].join(" "), class: "band" }, projG);
    const mid = pts.map((p, i) => `${i ? "L" : "M"}${xScale(t(p.date))},${yScale((p.low + p.high) / 2)}`).join("");
    el("path", { d: mid, class: "proj" }, projG);

    // History: the estimates themselves, solid marks
    const hist = el("g", { class: "hist" }, svg);
    for (const h of cfg.history) {
      const hx = xScale(t(h.date));
      if (h.high - h.low > 0) el("line", { x1: hx, x2: hx, y1: yScale(h.low), y2: yScale(h.high), class: "whisker" }, hist);
      el("circle", { cx: hx, cy: yScale((h.low + h.high) / 2), r: 4.5, class: h.qualifier === "at-most" ? "pt open" : "pt" }, hist);
    }

    // Recovery marker
    if (result.recovered.low) {
      const rx = xScale(t(result.recovered.low));
      el("circle", { cx: rx, cy: py, r: 5, class: "recover" }, svg);
      const rl = el("text", {
        x: Math.min(rx, width - M.right - 4),
        y: py + 18,
        class: "recover-label",
        "text-anchor": rx > width - 140 ? "end" : "middle",
      }, svg);
      rl.textContent = `Back by ${formatMonth(result.recovered.low)}`;
    }

    // Crosshair layer
    const cross = el("line", { y1: M.top, y2: M.top + ih, class: "cross", visibility: "hidden" }, svg);
    const hit = el("rect", { x: M.left, y: M.top, width: iw, height: ih, fill: "transparent", tabindex: 0 }, svg);
    hit.setAttribute("aria-label", "Projection chart. Use left and right arrow keys to read values.");
    let focusIdx = pts.length - 1;

    const show = (i: number) => {
      const p = pts[Math.max(0, Math.min(pts.length - 1, i))];
      focusIdx = pts.indexOf(p);
      const px = xScale(t(p.date));
      cross.setAttribute("x1", String(px));
      cross.setAttribute("x2", String(px));
      cross.setAttribute("visibility", "visible");
      const v = document.createElement("strong");
      v.textContent =
        Math.round(p.low) === Math.round(p.high)
          ? nf.format(p.low)
          : `${nf.format(p.low)}–${nf.format(p.high)}`;
      const d = document.createElement("span");
      d.textContent = `${formatDate(p.date)} · ${t(p.date) <= t(cfg.today) ? "modeled" : "projected"}`;
      tip.replaceChildren(v, d);
      tip.hidden = false;
      const box = svg.getBoundingClientRect();
      const scale = box.width / width;
      const left = px * scale;
      tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
      tip.style.top = `${yScale(p.high) * scale - 8}px`;
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      tip.hidden = true;
    };
    const nearest = (clientX: number) => {
      const box = svg.getBoundingClientRect();
      const ms = x0 + (((clientX - box.left) * (width / box.width) - M.left) / iw) * (x1 - x0);
      let best = 0;
      for (let i = 1; i < pts.length; i++) if (Math.abs(t(pts[i].date) - ms) < Math.abs(t(pts[best].date) - ms)) best = i;
      return best;
    };
    hit.addEventListener("pointermove", (e) => show(nearest((e as PointerEvent).clientX)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(focusIdx));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === "ArrowRight" || k === "ArrowLeft") {
        e.preventDefault();
        show(focusIdx + (k === "ArrowRight" ? 1 : -1));
      }
    });
  }

  function renderTable() {
    // Quarterly rows keep the table readable; the chart has every month.
    const rows = result.points.filter((p, i) => i === 0 || /-(01|04|07|10)-01$/.test(p.date));
    tableBody.replaceChildren(
      ...rows.map((p) => {
        const tr = document.createElement("tr");
        for (const text of [formatDate(p.date), nf.format(p.low), nf.format(p.high)]) {
          const td = document.createElement("td");
          td.textContent = text;
          if (text !== formatDate(p.date)) td.className = "num";
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  for (const input of root.querySelectorAll("input, select")) input.addEventListener("input", update);
  root.querySelector("button[type=reset]")?.addEventListener("click", () => setTimeout(update));
  new ResizeObserver(() => renderChart()).observe(svg);
  update();
}

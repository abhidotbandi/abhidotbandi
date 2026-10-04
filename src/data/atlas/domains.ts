export type DomainId = "defense-space" | "chips-compute" | "energy-mobility" | "robotics-mfg" | "big-tech" | "finance";

export interface Domain {
  id: DomainId;
  label: string;
  short: string;
  /** Validated as a 6-hue all-pairs set against the day (#efe8d8) and night (#0e1626)
   *  map surfaces; see docs/atlas/PLAN.md. Marks only; text stays in ink. */
  day: string;
  night: string;
}

export const DOMAINS: Record<DomainId, Domain> = {
  "defense-space": { id: "defense-space", label: "Defense & Space", short: "Defense", day: "#eda100", night: "#c98500" },
  "chips-compute": { id: "chips-compute", label: "Chips & Compute", short: "Chips", day: "#4a3aa7", night: "#9085e9" },
  "energy-mobility": { id: "energy-mobility", label: "Energy & Mobility", short: "Energy", day: "#008300", night: "#008300" },
  "robotics-mfg": { id: "robotics-mfg", label: "Robotics & Manufacturing", short: "Robotics", day: "#e87ba4", night: "#d55181" },
  "big-tech": { id: "big-tech", label: "Big Tech", short: "Big tech", day: "#5d8ff0", night: "#4859dd" },
  finance: { id: "finance", label: "Finance & Trading", short: "Finance", day: "#931848", night: "#904651" },
};

export const DOMAIN_ORDER: DomainId[] = ["defense-space", "chips-compute", "energy-mobility", "robotics-mfg", "big-tech", "finance"];

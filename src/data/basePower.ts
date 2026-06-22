export const BASE_POWER = {
  founded: 2023,
  founders: ["Zach Dell", "Justin Lopas"],
  hq: "Austin, Texas",
  thesis:
    "Be the energy provider and the backup power provider at once: install a big battery at every home, let it earn its keep on the grid, and pass the savings back as a flat, low electricity rate.",
  hardware: {
    capacityRange: "25-50 kWh per home battery",
    install: "$495 upfront, $16/month",
    rate: "Fixed rate locked for 3 years, guaranteed below the market average on renewal",
    failover: "Backup kicks in automatically, typically in under half a second",
    backupDuration: "Up to 24 hours on one battery, 48 on two, at reduced household load",
  },
  howItWorks: [
    "The battery charges overnight or whenever wholesale power is cheap.",
    "During grid stress - a heat wave, a cold snap, a price spike - Base dispatches stored energy back into ERCOT's market instead of letting your AC pull straight from a strained grid.",
    "If the grid actually fails, a hub at the house disconnects you from it in under a second and your battery silently takes over - no generator, no manual switch.",
    "Multiplied across thousands of homes, those batteries function as a single, dispatchable virtual power plant that ERCOT can lean on the way it leans on a gas peaker plant.",
  ],
  scale: {
    asOf: "Late 2025",
    homes: "7,000+",
    homesGrowth: "Scaled from roughly 1,500 homes in mid-2025 to 7,000+ by year end",
    deployPace: "~20 MW of new battery capacity per month",
    funding: "~$1.3B raised (Series B: $200M, Series C: $1B at a $4B valuation)",
    market: "Texas (ERCOT) today, with plans to expand to other competitive energy markets",
  },
  sourcesNote:
    "Figures are illustrative, drawn from Base Power's public site and press coverage as of early 2026, and will drift as the company keeps scaling.",
};

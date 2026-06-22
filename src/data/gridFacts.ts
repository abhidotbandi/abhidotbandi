export const INTERCONNECTIONS = [
  {
    id: "eastern",
    name: "Eastern Interconnection",
    color: "#38bdf8",
    blurb:
      "Covers everything east of the Rockies, from the Dakotas to Florida. Hundreds of utilities share one synchronized AC frequency.",
  },
  {
    id: "western",
    name: "Western Interconnection",
    color: "#34d399",
    blurb:
      "Spans the Rockies to the Pacific. Smaller and more spread out, it links hydro-heavy states like Washington and Oregon to desert solar in Arizona and Nevada.",
  },
  {
    id: "ercot",
    name: "ERCOT (Texas)",
    color: "#f5a623",
    blurb:
      "Almost all of Texas runs its own island grid, deliberately disconnected from the rest of the country to dodge federal regulation. That independence is also its biggest weakness.",
  },
] as const;

export const GRID_BASICS = {
  generation:
    "Power plants - gas, nuclear, wind, solar, coal - generate electricity at around 12-25 kilovolts.",
  transmission:
    "Step-up transformers push it to 115-765 kilovolts so it can travel hundreds of miles over high-voltage lines with minimal loss.",
  substation:
    "Substations near cities step the voltage back down, splitting the load across regional distribution networks.",
  distribution:
    "Local lines drop voltage again - down to the 120/240 volts that finally reaches a wall outlet.",
};

export const ERCOT_FACTS = {
  isolation:
    "ERCOT is a single synchronous AC grid with almost no high-capacity ties to its neighbors. When it runs short, it cannot import meaningful power from other states.",
  uri: {
    title: "Winter Storm Uri, February 2021",
    detail:
      "A polar vortex froze gas wellheads and wind turbines at once. ERCOT shed load to avoid total collapse. 4.5 million homes lost power, some for days, and over 200 people died.",
  },
  summerPeak:
    "Texas demand is dominated by air conditioning. Record summer afternoons can push demand past 85 GW, almost double the grid's winter baseline.",
  growth:
    "Data centers, EVs, and population growth are pushing ERCOT's peak demand forecasts up faster than new transmission and generation can be built.",
};

export const DUCK_CURVE = {
  title: "The duck curve",
  detail:
    "As solar output rises midday, net demand on traditional power plants dips - then snaps back hard in the evening when the sun sets but air conditioners and lights are still running. That steep ramp is one of the hardest problems for a grid operator.",
  hours: [0, 3, 6, 9, 12, 15, 18, 21],
  netDemandGW: [42, 38, 40, 30, 18, 22, 55, 50],
};

export const VPP_EXPLAINER = {
  title: "What is a virtual power plant?",
  detail:
    "Thousands of small batteries, each sitting in a garage or utility closet, can be dispatched together as if they were one large power plant - charging when the grid has spare capacity, discharging in unison when it's stressed. No new transmission lines, no new gas plant, just better coordination of resources that already exist.",
};

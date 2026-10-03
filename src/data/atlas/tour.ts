export interface StopView {
  lon: number;
  lat: number;
  /** camera distance from the target, km */
  dist: number;
  /** degrees from straight down */
  tilt: number;
  /** degrees clockwise from north; the direction the camera faces */
  bearing: number;
  /** keep this exact framing instead of fitting the stop's sites */
  fixed?: boolean;
}

export interface Stop {
  id: string;
  /** Short name for the chapter index */
  name: string;
  kicker: string;
  title: string;
  body: string;
  /** Site ids featured at this stop, in reading order */
  sites: string[];
  /** Sites to fit in frame, when not all of `sites` (e.g. one is far away) */
  frame?: string[];
  view: StopView;
  /** 0 dawn → 0.5 noon → 0.88 dusk → 1 night */
  tod: number;
  effect?: "bats" | "plume";
  /** screens of scroll to linger here */
  dwell?: number;
}

export const STOPS: Stop[] = [
  {
    id: "intro",
    name: "The Silicon Hills",
    kicker: "A living atlas of Austin's hard tech",
    title: "The Silicon Hills",
    body: "Downtown Austin from above Lady Bird Lake, the Capitol at the head of Congress Avenue and the UT Tower beyond. From here out to the hills, companies are building warships, rockets, humanoids, reactors and the chips inside all of them.",
    sites: [],
    view: { lon: -97.744, lat: 30.2712, dist: 4.4, tilt: 60, bearing: 4, fixed: true },
    tod: 0.26,
    dwell: 1.3,
  },
  {
    id: "lake",
    name: "Lady Bird Lake",
    kicker: "01 · Lady Bird Lake",
    title: "Morning on the river",
    body: "Downtown's river is a lake: Longhorn Dam has held it since 1960, and most motorboats are banned. So the calm water belongs to rowing crews, kayakers and paddleboarders, while runners circle the 10-mile Butler Trail along both shores.",
    sites: [],
    view: { lon: -97.7555, lat: 30.2632, dist: 2.2, tilt: 60, bearing: 72, fixed: true },
    tod: 0.28,
    dwell: 1.2,
  },
  {
    id: "downtown",
    name: "Downtown",
    kicker: "02 · Downtown",
    title: "The Army moved into an office tower",
    body: "In 2018 the Army put its modernization command in the UT System building on 7th Street instead of on a base. In 2025 it merged with TRADOC into T2COM and stayed. Soldiers learn to ship software at ACC's Rio Grande campus, the Army's startup scouts work out of Capital Factory, and two chip companies keep their HQs a few blocks away.",
    sites: ["t2com", "army-software-factory", "army-applications-lab", "silicon-labs", "cirrus-logic", "base-power", "diligent-robotics"],
    view: { lon: -97.7445, lat: 30.2672, dist: 2.6, tilt: 58, bearing: -28, fixed: true },
    tod: 0.3,
  },
  {
    id: "st-elmo",
    name: "St. Elmo",
    kicker: "03 · St. Elmo",
    title: "Hard-tech row",
    body: "A few blocks of warehouses off South Congress now hold a 3D-printed-building company, a microreactor startup, a power-semiconductor maker and a counter-drone weapons company valued at $2.2 billion. Further south in Buda, Perseus Defense is building micro-missiles to knock down drones.",
    sites: ["allen-control-systems", "icon", "last-energy", "ideal-power", "perseus-defense"],
    frame: ["allen-control-systems", "icon", "last-energy", "ideal-power"],
    view: { lon: -97.7605, lat: 30.2165, dist: 2.6, tilt: 54, bearing: -24 },
    tod: 0.32,
  },
  {
    id: "industrial-belt",
    name: "Montopolis",
    kicker: "04 · Montopolis to the airport",
    title: "The new industrial belt",
    body: "SEMATECH's original fab is being refit into DARPA's $1.4 billion 3D-chip foundry. Around it: a U.S. trusted-foundry fab, a reactor factory, Saronic's autonomous-ship plant and the site of Base Power's second battery factory.",
    sites: ["tie", "skywater", "aalo", "nanohmics", "saronic", "base-power-factory-2", "fox-robotics"],
    view: { lon: -97.702, lat: 30.2095, dist: 6.2, tilt: 52, bearing: 12 },
    tod: 0.34,
  },
  {
    id: "highway-71",
    name: "Highway 71",
    kicker: "05 · Highway 71",
    title: "Musk country",
    body: "Tesla's headquarters sits on about 2,500 acres by the Colorado River, with the Cortex AI training clusters under the same roofs. Twenty miles east in Bastrop, SpaceX builds Starlink kits and The Boring Company builds its tunneling machines.",
    sites: ["tesla", "spacex", "boring-company"],
    view: { lon: -97.555, lat: 30.2, dist: 23, tilt: 58, bearing: 104, fixed: true },
    tod: 0.42,
  },
  {
    id: "zilker",
    name: "Zilker & Barton Springs",
    kicker: "06 · Zilker Park",
    title: "Midday at the springs",
    body: "West of downtown, Austin cools off in Barton Springs, a pool the city dammed out of the creek in the 1920s. Springs from the Edwards Aquifer keep it between about 68 and 74 °F all year. Next door, Zilker Park's 350 acres fill with picnics and kites, and a miniature train, the Zilker Eagle, runs through it.",
    sites: [],
    view: { lon: -97.77, lat: 30.2652, dist: 1.5, tilt: 58, bearing: 58, fixed: true },
    tod: 0.46,
  },
  {
    id: "east-austin",
    name: "East Austin",
    kicker: "07 · East Austin",
    title: "Where the chips began",
    body: "Motorola came to Austin in 1974 and its fabs live on as NXP. Tracor, Austin's first homegrown defense company, lives on as BAE Systems' electronic-warfare plant. Applied Materials builds chipmaking tools out by Walter E. Long Lake.",
    sites: ["nxp-ed-bluestein", "bae-systems", "applied-materials", "energyx"],
    view: { lon: -97.643, lat: 30.296, dist: 9.5, tilt: 52, bearing: -28 },
    tod: 0.48,
  },
  {
    id: "taylor",
    name: "Taylor",
    kicker: "08 · Taylor",
    title: "A $37 billion bet",
    body: "Samsung's second Texas fab rose out of farmland 40 km northeast of downtown. Backed by a $4.745 billion CHIPS Act award and a $16.5 billion Tesla contract, it began producing AI chips in 2026.",
    sites: ["samsung-taylor"],
    view: { lon: -97.4526, lat: 30.5374, dist: 3.8, tilt: 56, bearing: 24, fixed: true },
    tod: 0.53,
  },
  {
    id: "parmer",
    name: "Parmer Lane",
    kicker: "09 · Parmer Lane",
    title: "Fabs, drones and turrets",
    body: "Samsung broke ground on its first U.S. fab here in 1996, with the Longhorn Band and a rodeo. Tech Ridge now builds autonomous cargo drones, and Allen Control Systems is turning a 1991 insurance campus into a counter-drone factory.",
    sites: ["samsung", "skyways", "allen-control-systems-factory", "infinitum"],
    view: { lon: -97.662, lat: 30.425, dist: 13, tilt: 52, bearing: -8 },
    tod: 0.58,
  },
  {
    id: "domain",
    name: "The Domain",
    kicker: "10 · The Domain & Pickle Research Campus",
    title: "Robots, radars and research",
    body: "UT's Pickle Research Campus holds the lab behind the Navy's submarine sonar, NSF's new Horizon supercomputer at TACC, and space geodesy. Within a couple of kilometers: Apptronik's humanoids, NI's test gear and new AI chips from Neurophos and Mythic.",
    sites: ["apptronik", "arl-ut", "tacc", "neurophos", "mythic", "ni", "canon-nanotechnologies", "ut-csr"],
    view: { lon: -97.7185, lat: 30.3935, dist: 4.2, tilt: 56, bearing: -32 },
    tod: 0.63,
  },
  {
    id: "cedar-park",
    name: "Cedar Park",
    kicker: "11 · Cedar Park",
    title: "Launch control",
    body: "Scottsdale Drive has become a defense corridor: Firefly's mission control and lunar-lander lines, Aeon Industrial's missile factory next door, and Hyliion's linear generators down the road.",
    sites: ["firefly", "aeon-industrial", "hyliion"],
    view: { lon: -97.806, lat: 30.523, dist: 4.6, tilt: 56, bearing: 14 },
    tod: 0.68,
  },
  {
    id: "briggs",
    name: "Briggs",
    kicker: "12 · Briggs",
    title: "The Rocket Ranch",
    body: "An hour northwest, Firefly test-fires engines on a 200-acre ranch. In March 2025 its Blue Ghost lander made the first fully successful commercial landing on the Moon.",
    sites: ["firefly-ranch"],
    view: { lon: -97.9255, lat: 30.8805, dist: 2.2, tilt: 60, bearing: 32, fixed: true },
    tod: 0.73,
    effect: "plume",
  },
  {
    id: "hills",
    name: "The Hills",
    kicker: "13 · The Hills",
    title: "Satellites in the cedar",
    body: "West of MoPac the land climbs the Balcones Escarpment into the Hill Country: the real hills behind Austin's “Silicon Hills” nickname. CesiumAstro is putting $500 million into Bee Cave to build phased-array payloads and whole satellites, while AMD, NXP and Ambiq design chips in the hills.",
    sites: ["cesiumastro", "ambiq", "amd", "nxp-oak-hill"],
    view: { lon: -97.875, lat: 30.305, dist: 17, tilt: 60, bearing: -45 },
    tod: 0.79,
  },
  {
    id: "bats",
    name: "The bats",
    kicker: "14 · Congress Avenue Bridge",
    title: "Meet the bats",
    body: "On warm evenings up to 1.5 million Mexican free-tailed bats pour out from under the Congress Avenue Bridge, one of the largest urban bat colonies in North America. Base Power builds batteries in the old Statesman printing plant next door.",
    sites: ["base-power"],
    view: { lon: -97.7452, lat: 30.2634, dist: 1.8, tilt: 60, bearing: 6, fixed: true },
    tod: 0.89,
    effect: "bats",
    dwell: 1.5,
  },
  {
    id: "rainey",
    name: "Rainey Street",
    kicker: "15 · Rainey Street",
    title: "Rainey Street after dark",
    body: "A few blocks east of the bats, the old bungalows on Rainey Street were rezoned for downtown in 2004 and turned into bars with yards full of string lights, while towers went up all around them. Up on East 6th, crowds fill the street under the neon.",
    sites: [],
    view: { lon: -97.7392, lat: 30.2592, dist: 0.9, tilt: 48, bearing: 12, fixed: true },
    tod: 0.95,
  },
  {
    id: "night",
    name: "Night",
    kicker: "Your turn",
    title: "The Silicon Hills at night",
    body: "Drag the map, search for a company or a landmark, or ride the Red Line from Leander to downtown.",
    sites: [],
    view: { lon: -97.74, lat: 30.37, dist: 62, tilt: 42, bearing: 4, fixed: true },
    tod: 1,
    dwell: 1.2,
  },
];

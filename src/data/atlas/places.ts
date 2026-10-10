import { project } from "@/lib/atlas/geo";

// Places around central Austin: the landmarks, water and parks drawn in detail on the map, each
// with a short card of facts. Every fact is from the listed sources (checked September 2026).

export interface Place {
  id: string;
  name: string;
  /** what kind of place, for the card's kicker */
  kind: string;
  lat: number;
  lon: number;
  /** an existing map label that stands for this place, if any (its text, exactly) */
  label?: string;
  /** camera framing, and the time of day it looks best at, if any (0 dawn .. 1 night) */
  view: { dist: number; tilt: number; bearing: number; tod?: number };
  blurb: string;
  facts: string[];
  sources: { label: string; url: string }[];
}

const wiki = (title: string, label = title.replace(/_/g, " ")) => ({
  label: `Wikipedia: ${label}`,
  url: `https://en.wikipedia.org/wiki/${title}`,
});

export const PLACES_RAW: Place[] = [
  {
    id: "lady-bird-lake",
    name: "Lady Bird Lake",
    kind: "Lake",
    lat: 30.2638,
    lon: -97.752,
    label: "Lady Bird Lake",
    view: { dist: 2.2, tilt: 58, bearing: 70, tod: 0.2 },
    blurb:
      "The Colorado River through downtown, held back as a lake. With most motorboats banned, the water belongs to rowing crews, kayakers and paddleboarders.",
    facts: [
      "Formed as Town Lake when the city built Longhorn Dam in 1960; renamed for Lady Bird Johnson in July 2007, after her death.",
      "The city prohibits most motorized watercraft, and swimming has been banned since 1964.",
      "Crews come for the calm water, the warm climate and nearly 6 miles (9.7 km) of mostly straight course.",
    ],
    sources: [wiki("Lady_Bird_Lake")],
  },
  {
    id: "butler-trail",
    name: "Butler Hike-and-Bike Trail",
    kind: "Trail",
    lat: 30.264,
    lon: -97.759,
    view: { dist: 0.9, tilt: 58, bearing: 60, tod: 0.3 },
    blurb:
      "The Ann and Roy Butler Hike-and-Bike Trail loops the lake along both shores: runners at dawn and dusk, walkers and cyclists all day.",
    facts: [
      "10.1 miles (16.3 km) around, and mostly flat: 97.5% of it is under an 8% grade.",
      "Named for Ann and Roy Butler in 2011.",
    ],
    sources: [wiki("Lady_Bird_Lake")],
  },
  {
    id: "barton-springs",
    name: "Barton Springs Pool",
    kind: "Spring-fed pool",
    lat: 30.2638,
    lon: -97.7712,
    view: { dist: 0.45, tilt: 58, bearing: 75, tod: 0.5 },
    blurb:
      "A swimming hole the city dammed out of Barton Creek in the 1920s, filled entirely by springs from the Edwards Aquifer, with a grassy hillside for lying in the sun.",
    facts: [
      "The water stays between about 68 °F and 74 °F (20–23 °C) all year.",
      "Main Barton Spring is the fourth-largest spring in Texas.",
      "Home to the Barton Springs salamander, a listed species found only here and nearby.",
      "The Streamline Moderne bathhouse was designed in 1947.",
    ],
    sources: [wiki("Barton_Springs_Pool")],
  },
  {
    id: "zilker-park",
    name: "Zilker Park",
    kind: "Park",
    lat: 30.267,
    lon: -97.769,
    label: "Zilker Park",
    view: { dist: 1.2, tilt: 56, bearing: 20, tod: 0.5 },
    blurb:
      "More than 350 acres of lawn, trails and water on the south bank: picnics under the pecans, kites over the Great Lawn, and a festival stage each fall.",
    facts: [
      "Andrew Jackson Zilker sold the land to the city in stages in 1917, 1923 and 1931.",
      "The Austin City Limits Music Festival fills the park for two weekends each fall.",
      "The miniature train ran as the Zilker Zephyr from 1961 to 2019 and reopened as the Zilker Eagle in 2023.",
    ],
    sources: [wiki("Zilker_Park")],
  },
  {
    id: "pease-park",
    name: "Pease Park",
    kind: "Park",
    lat: 30.2822,
    lon: -97.7524,
    view: { dist: 0.32, tilt: 52, bearing: -30, tod: 0.45 },
    blurb:
      "Woods along Shoal Creek a few blocks from downtown, with the Shoal Creek Trail down its length and dogs in its meadows. At its south end, Kingsbury Commons has a splash pad, an all-abilities playground and a steel treehouse orb.",
    facts: [
      "Governor Elisha M. Pease and his wife gave the land to the city in 1875.",
      "84 acres along Shoal Creek, between West 15th and 31st Streets.",
      "Kingsbury Commons, the park's south end, reopened in June 2021 after a $15 million rebuild led by Ten Eyck Landscape Architects.",
      "Its Treehouse, by Mell Lawrence Architects, is a two-level steel orb about 40 feet across, with a cargo net to lie on.",
      "Eeyore's Birthday Party has been held here every spring since 1974.",
      "Thomas Dambo's wooden troll Malin stood in the park from March 2024 until it burned in May 2026.",
    ],
    sources: [
      wiki("Pease_Park"),
      { label: "Pease Park Conservancy: Kingsbury Commons", url: "https://peasepark.org/kingsbury-commons" },
      { label: "ARQA: Kingsbury Commons at Pease Park", url: "https://arqa.com/en/architecture/kingsbury-commons-at-pease-park.html" },
    ],
  },
  {
    id: "deep-eddy",
    name: "Deep Eddy Pool",
    kind: "Pool",
    lat: 30.2765,
    lon: -97.7733,
    view: { dist: 0.4, tilt: 56, bearing: 20, tod: 0.5 },
    blurb: "The oldest swimming pool in Texas, beside the river west of downtown.",
    facts: [
      "A concrete pool first opened here in 1916; the public pool and bathhouse opened in July 1936.",
      "Filled from two wells, 300 and 400 ft deep, and not chlorinated.",
      "Listed on the National Register of Historic Places in 2003.",
    ],
    sources: [wiki("Deep_Eddy_Pool")],
  },
  {
    id: "congress-bridge",
    name: "Congress Avenue Bridge",
    kind: "Bridge",
    lat: 30.2615,
    lon: -97.7452,
    label: "Congress Ave. Bridge",
    view: { dist: 0.6, tilt: 60, bearing: 0, tod: 0.88 },
    blurb:
      "The Ann W. Richards Congress Avenue Bridge shelters the world's largest urban bat colony. On summer evenings crowds line the railings and boats wait below to watch them fly out.",
    facts: [
      "Between 750,000 and 1.5 million Mexican free-tailed bats live under it each summer, then winter in Mexico.",
      "It's a maternity colony: females raise their pups here from mid-summer into fall.",
      "The current bridge opened in 1910. The emergence draws as many as 100,000 visitors a year.",
    ],
    sources: [wiki("Ann_W._Richards_Congress_Avenue_Bridge")],
  },
  {
    id: "capitol",
    name: "Texas State Capitol",
    kind: "Landmark",
    lat: 30.2747,
    lon: -97.7404,
    label: "Texas Capitol",
    view: { dist: 0.8, tilt: 58, bearing: 0, tod: 0.78 },
    blurb: "Sunset-red granite at the head of Congress Avenue, opened to the public in 1888.",
    facts: [
      "302.64 ft (92.24 m) tall: one of several state capitols taller than the U.S. Capitol.",
      "Sheathed in sunset red granite from Granite Mountain near Marble Falls, donated by its owners.",
      "The Goddess of Liberty on the dome is a 1986 aluminum cast of the original zinc statue.",
    ],
    sources: [wiki("Texas_State_Capitol")],
  },
  {
    id: "ut-tower",
    name: "UT Tower",
    kind: "Landmark",
    lat: 30.2862,
    lon: -97.7394,
    label: "UT Tower",
    view: { dist: 0.9, tilt: 58, bearing: 10, tod: 1 },
    blurb: "The University of Texas Main Building and its tower, finished in 1937 to Paul Cret's design.",
    facts: [
      "The tower rises 307 ft (94 m).",
      "Orange light on the tower has marked the university's big moments since 1937, under guidelines first set in 1947.",
    ],
    sources: [wiki("Main_Building_(University_of_Texas_at_Austin)", "Main Building (UT Austin)")],
  },
  {
    id: "moonlight-towers",
    name: "Moonlight towers",
    kind: "Landmark",
    lat: 30.27188,
    lon: -97.74528,
    view: { dist: 0.7, tilt: 56, bearing: 20, tod: 1 },
    blurb:
      "Iron lattice towers that light whole blocks from above. Austin is the only city in the world known to still have them.",
    facts: [
      "Installed in 1895; each is 165 ft (50 m) tall.",
      "Each carried six carbon arc lamps lighting a 1,500 ft (460 m) radius.",
      "The city restored every bolt and guy-wire in 1993 and switched the last of them to LED in 2024.",
    ],
    sources: [wiki("Moonlight_towers", "Moonlight tower")],
  },
  {
    id: "rainey-street",
    name: "Rainey Street",
    kind: "Street",
    lat: 30.2585,
    lon: -97.7392,
    view: { dist: 0.35, tilt: 38, bearing: 20, tod: 0.97 },
    blurb: "A street of old bungalows turned bars, with yards full of string lights and high-rises all around.",
    facts: [
      "The houses date from 1875 to 1945; the district was listed on the National Register in 1985.",
      "Rezoned into the central business district in 2004, which let the bungalows become bars and lounges.",
      "None of the buildings is individually designated historic, and towers have risen around them.",
    ],
    sources: [wiki("Rainey_Street_Historic_District")],
  },
  {
    id: "frost-bank-tower",
    name: "Frost Bank Tower",
    kind: "Tower",
    lat: 30.26638,
    lon: -97.74272,
    view: { dist: 0.9, tilt: 55, bearing: 330 },
    blurb: "A crown of folded glass that steps back to a point: the “owl face” of the skyline.",
    facts: ["Completed in 2003 and opened in January 2004.", "515 ft (157 m) tall, with 33 floors."],
    sources: [wiki("Frost_Bank_Tower")],
  },
  {
    id: "the-independent",
    name: "The Independent",
    kind: "Tower",
    lat: 30.2678,
    lon: -97.75117,
    view: { dist: 1, tilt: 50, bearing: 70 },
    blurb: "Austin's “Jenga Tower”: stacked blocks of condos, each slid off the one below.",
    facts: ["Completed in 2019: 690 ft tall, with 58 floors.", "Designed by the Austin firm Rhode Partners."],
    sources: [wiki("The_Independent_(Austin,_Texas)", "The Independent (Austin, Texas)")],
  },
  {
    id: "dkr-stadium",
    name: "Darrell K Royal–Texas Memorial Stadium",
    kind: "Stadium",
    lat: 30.28388,
    lon: -97.73261,
    view: { dist: 0.75, tilt: 55, bearing: 350, tod: 0.5 },
    blurb: "Home of Texas Longhorns football since 1924.",
    facts: [
      "Seats 100,119, among the largest stadiums in the United States.",
      "Dedicated to the 198,520 Texans who served in World War I, 5,280 of whom died.",
      "Named for coach Darrell K Royal in 1996.",
    ],
    sources: [wiki("Darrell_K_Royal–Texas_Memorial_Stadium", "Darrell K Royal–Texas Memorial Stadium")],
  },
  {
    id: "mount-bonnell",
    name: "Mount Bonnell",
    kind: "Lookout",
    lat: 30.3216,
    lon: -97.7733,
    label: "Mount Bonnell",
    view: { dist: 0.6, tilt: 58, bearing: 250, tod: 0.8 },
    blurb: "A lookout over Lake Austin, downtown and the hills, and a destination since the 1850s.",
    facts: ["About 775 ft (236 m) above sea level.", "Also known as Covert Park: 5.36 acres, with a historical marker from 1939."],
    sources: [wiki("Mount_Bonnell")],
  },
  {
    id: "pennybacker",
    name: "Pennybacker Bridge",
    kind: "Bridge",
    lat: 30.3499,
    lon: -97.797,
    label: "Pennybacker Bridge",
    view: { dist: 0.8, tilt: 62, bearing: 300, tod: 0.75 },
    blurb: "Loop 360's weathering-steel arch over Lake Austin.",
    facts: [
      "Opened December 3, 1982: 1,150 ft (351 m) long with a 600 ft (183 m) arch.",
      "The deck hangs from the arch on 72 steel cables; no part of the bridge touches the water 100 ft below.",
      "Four lanes plus a 6-ft bike and pedestrian lane.",
    ],
    sources: [wiki("Pennybacker_Bridge")],
  },
  {
    id: "tom-miller-dam",
    name: "Tom Miller Dam",
    kind: "Dam",
    lat: 30.2957,
    lon: -97.7858,
    label: "Tom Miller Dam",
    view: { dist: 0.5, tilt: 60, bearing: 315 },
    blurb: "The dam that forms Lake Austin, where the river steps down toward downtown.",
    facts: [
      "In service since 1940: 100.5 ft (30.6 m) tall and 1,590 ft (485 m) long.",
      "It stands where two earlier Austin Dams were destroyed by floods.",
      "Operated by the Lower Colorado River Authority.",
    ],
    sources: [wiki("Tom_Miller_Dam")],
  },
  {
    id: "longhorn-dam",
    name: "Longhorn Dam",
    kind: "Dam",
    lat: 30.2503,
    lon: -97.7138,
    label: "Longhorn Dam",
    view: { dist: 0.45, tilt: 60, bearing: 250 },
    blurb: "The low dam at the east end of downtown that holds back Lady Bird Lake, with Pleasant Valley Road on top.",
    facts: ["Built by the city in 1960 to form what was then Town Lake."],
    sources: [wiki("Lady_Bird_Lake")],
  },
];

export interface PlaceRef extends Place {
  index: number;
  x: number;
  z: number;
}

export const PLACES: PlaceRef[] = PLACES_RAW.map((p, index) => {
  const [x, z] = project(p.lon, p.lat);
  return { ...p, index, x, z };
});

export const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));

/** Places standing in for an existing map label, by the label's text. */
export const PLACE_BY_LABEL = new Map(PLACES.filter((p) => p.label).map((p) => [p.label!, p]));

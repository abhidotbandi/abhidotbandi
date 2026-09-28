// The University of Texas at Austin, for the buildings' campus styles: the main campus (Overture
// base/land_use "University of Texas at Austin", its largest part, simplified to ~6 m), West
// Campus across Guadalupe, and the campus buildings with flat roofs. Points are [lon, lat].

export const UT_CAMPUS: [number, number][] = [
  [-97.73498, 30.29116], [-97.73585, 30.2921], [-97.7361, 30.2928], [-97.73621, 30.29285], [-97.7364, 30.29274],
  [-97.73653, 30.29249], [-97.73654, 30.29159], [-97.73886, 30.29175], [-97.73896, 30.29085], [-97.74019, 30.29095],
  [-97.74013, 30.29183], [-97.74111, 30.29189], [-97.74134, 30.2894], [-97.74216, 30.28947], [-97.74219, 30.28918],
  [-97.74135, 30.28909], [-97.74191, 30.28272], [-97.73987, 30.28252], [-97.7398, 30.28317], [-97.7403, 30.28321],
  [-97.74025, 30.28376], [-97.73899, 30.28368], [-97.73923, 30.28107], [-97.73434, 30.27971], [-97.73492, 30.27859],
  [-97.73582, 30.27604], [-97.73262, 30.2751], [-97.73198, 30.275], [-97.7318, 30.27517], [-97.73156, 30.27613],
  [-97.73076, 30.27828], [-97.72967, 30.28087], [-97.72878, 30.28205], [-97.72747, 30.28318], [-97.72526, 30.28654],
  [-97.72734, 30.28723], [-97.72884, 30.28799], [-97.73002, 30.28891], [-97.73106, 30.28915], [-97.73238, 30.28909],
  [-97.73245, 30.28973], [-97.73271, 30.2896], [-97.73337, 30.2895], [-97.73459, 30.29011], [-97.7347, 30.29066],
];

/** The red tile roofs stop at MLK Boulevard: south of it are the medical school's towers. */
export const TILE_ROOFS_NORTH_OF = 30.28;

/** Campus buildings with flat roofs: LBJ's travertine block, the modern halls and libraries. */
export const FLAT_ROOFED: [number, number][] = [
  [-97.72926, 30.28592], // LBJ Library
  [-97.72883, 30.28503], // Sid Richardson Hall
  [-97.73817, 30.28296], // Perry-Castañeda Library
  [-97.73671, 30.28249], // Jester Center
  [-97.73227, 30.287], // Texas Memorial Museum
  [-97.73121, 30.2864], // Bass Concert Hall
];

/** West Campus, the student neighbourhood west of Guadalupe: MLK Boulevard north to 29th St. */
export const WEST_CAMPUS: [number, number][] = [
  [-97.7424, 30.2808],
  [-97.7424, 30.2958],
  [-97.7505, 30.2958],
  [-97.7512, 30.2808],
];

/** Littlefield Fountain, at the south end of the South Mall. */
export const LITTLEFIELD_FOUNTAIN: [number, number] = [-97.73961, 30.28385];

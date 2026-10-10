"""Buildings Overture hasn't mapped yet, traced from other sources. build_buildings.load() adds
them to Overture's footprints, and leaves out any Overture footprint they cover.

Tower Business Park, 1340 FM 2001, Buda: six tilt-wall shallow-bay industrial buildings built in
2024-25 (Texas TDLR registrations TABS2024020606/10/12; 164,241 sq ft in all). Perseus Defense
fits out Building 2 as its headquarters (TDLR TABS2026017707, "Perseus Defense TI", 17,515 sq ft).
The footprints come from the leasing site plan (Balcones Real Estate Group and Lee & Associates,
2025), turned 90 degrees as the plan draws it, with Old FM 2001 along its left edge, and scaled by
Building 1's stated 160 x 110 ft. The plan was placed by fitting its roofs and paving to
Copernicus Sentinel-2 imagery of 7 October 2026 (brightness correlation, within 4 m of a fit to
the address points). All 14 of Overture's address points for 1340 FM 2001 fall inside the
buildings. Heights come from the listed clear heights (20 ft, and 24 ft for Buildings 5 and 6)
plus the roof and parapet.

TRACED: [(name, height m, ring [(lon, lat), ...])]
"""

TRACED = [
    ("Tower Business Park Building 1", 8.0,
     [(-97.808763, 30.070038), (-97.808767, 30.069729), (-97.809273, 30.069734), (-97.80927, 30.070043)]),
    ("Tower Business Park Building 2", 8.0,
     [(-97.808772, 30.069281), (-97.808775, 30.068981), (-97.809282, 30.068986), (-97.809279, 30.069285)]),
    ("Tower Business Park Building 3", 8.0,
     [(-97.808413, 30.068109), (-97.808419, 30.067583), (-97.808732, 30.067586), (-97.808726, 30.068112)]),
    ("Tower Business Park Building 4", 8.5,
     [(-97.808483, 30.067278), (-97.808486, 30.066996), (-97.809091, 30.067001), (-97.809087, 30.067283)]),
    ("Tower Business Park Building 5", 9.2,
     [(-97.810063, 30.066891), (-97.81007, 30.066357), (-97.810533, 30.066361), (-97.810526, 30.066895)]),
    ("Tower Business Park Building 6", 9.2,
     [(-97.810071, 30.066266), (-97.810085, 30.065108), (-97.810548, 30.065112), (-97.810534, 30.06627)]),
]

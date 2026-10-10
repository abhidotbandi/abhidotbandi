"""Buildings whose Overture heights are wrong or missing, drawn at their real heights.

Overture has some of Austin's towers at their parking podiums' height (Sixth and Guadalupe, the
city's second tallest at 267 m, at 18.7 m), and others with no height at all, which leaves them
at the 10 m given to an unknown building. Heights here are the CTBUH figures in Wikipedia's
"List of tallest buildings in Austin" (2026), or storey counts at ~3.5 m (offices ~4 m) where
a building is shorter than that list's 93 m.

Each entry: (name, lon, lat, height m, tower floor plate m^2 or None, podium height m or None).
The footprint under the point is the building. With a floor plate, it is drawn as its podium
(Overture's height, or the one given) with the tower rising from the middle, covering that much
of it; without one, the whole footprint rises to the height.
"""

TOWERS = [
    # The tallest towers Overture has too short or without a height (Wikipedia / CTBUH).
    ("Sixth and Guadalupe", -97.74665, 30.26965, 266.7, 2400, 30),  # 66 storeys; Overture 18.7 m
    ("Fairmont Austin", -97.73825, 30.26205, 180.0, 2000, None),  # 37 storeys; Overture 20.6 m
    ("The Travis", -97.74032, 30.25994, 171.3, 1700, 24),  # 50 storeys; no height
    ("Fifth & West", -97.75056, 30.26948, 139.9, None, None),  # 39 storeys; Overture 19.2 m
    ("Vesper", -97.73766, 30.25965, 138.7, None, None),  # 41 storeys; Overture 7.9 m
    ("Northshore", -97.74951, 30.26530, 129.3, 1800, None),  # 38 storeys; Overture 19.9 m
    ("One American Center", -97.74321, 30.26860, 122.2, 2230, None),  # 32 storeys over its garage; Overture 24.1 m
    ("Austin Marriott Downtown", -97.74151, 30.26285, 117.7, 1700, None),  # 31 storeys; Overture 11.6 m
    ("The Waller", -97.73454, 30.27142, 113.1, 1400, None),  # 32 storeys; Overture 12.3 m
    ("The Linden", -97.74209, 30.27943, 101.5, None, None),  # 28 storeys; Overture 14.7 m
    ("Domain Tower 2", -97.72196, 30.39468, 101.2, 1630, None),  # 24 storeys; Overture 26.1 m
    ("Union on San Antonio", -97.74281, 30.28330, 101.2, 1400, 15),  # 29 storeys; Overture 7.4 m
    ("Yugo Austin Waterloo", -97.74412, 30.28824, 97.5, None, None),  # 30 storeys; Overture 8.4 m
    ("Villas on 24th", -97.74441, 30.28767, 95.1, None, None),  # 31 storeys; no height
    ("Dobie Center", -97.74136, 30.28326, 93.6, 1500, None),  # 29 storeys over the mall; Overture 11.7 m
    # Shorter, from their storey counts.
    ("Domain 9", -97.71834, 30.40291, 74, 2950, 14),  # 18 storeys, podium-style (Endeavor); Overture 5.7 m
    ("Domain 12", -97.71935, 30.40410, 70, 2630, 14),  # 17 storeys (Cousins); Overture 3 m
    ("Domain 11", -97.71934, 30.40534, 66, 2270, None),  # Vrbo's tower, 16 storeys; no height
    ("Domain 10", -97.71839, 30.40479, 62, 2020, 14),  # 15 storeys, podium-style (Endeavor); no height
    ("Hyatt Regency Austin", -97.74679, 30.26073, 58, None, None),  # 17 storeys; no height
    ("One Uptown", -97.71802, 30.40052, 56, None, None),  # 14 storeys (Brandywine); no height
    ("Renaissance Austin Downtown", -97.73424, 30.27033, 55, None, None),  # 16 storeys; no height
    ("The Mark", -97.74647, 30.28773, 52, None, None),  # 15 storeys; no height
    ("Domain Tower", -97.72333, 30.39207, 44, None, None),  # 11 storeys; Overture 25.9 m
    ("Zilker Point", -97.75809, 30.26346, 32, None, None),  # 7 storeys; no height
    ("Dimensional Place", -97.83034, 30.29793, 20, None, None),  # a few storeys; Overture 61 m
    ("AUS Blue Garage", -97.66858, 30.20472, 18, None, None),  # 6 levels of parking; Overture 4.7 m
]

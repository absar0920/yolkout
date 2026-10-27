# Map collection

Yolkout has 40 arenas. The 20 newest maps are larger, original, nonhistorical places with camps, water, long sightlines, and mazes. Their horizontal footprints range from 84 to 100 units, compared with roughly 60 units for most earlier arenas. Each supports Free-For-All, Team Scramble, and Nest Raid.

## Larger original arenas

| Arena | Footprint | Setting and routes |
| --- | --- | --- |
| Pine Camp | 88 × 88 | Campsites, winding pine trails, and a climbable fire lookout |
| Lakeside Cabins | 92 × 84 | Cabin yards, shoreline shallows, a pier, and an island crossing |
| Marsh Boardwalk | 90 × 90 | Raised paths through shallow marsh and an observation deck |
| Canyon Camp | 96 × 84 | Sheltered camps in a winding wash below two rim shelves |
| Island Crossings | 88 × 88 | Bridges, sandy islets, and shallow lagoon approaches |
| Frozen Creek | 88 × 84 | Snowy shelters, footbridges, and a level frozen creek |
| Redwood Trails | 96 × 92 | Giant trunks, fallen logs, dry creek, and central stump |
| Ridge Watch | 96 × 92 | Paired overlooks above lower trails and a long saddle |
| Quarry Lookout | 92 × 92 | Terraces, stone stacks, haul lanes, and an open quarry floor |
| Desert Airfield | 100 × 84 | Exposed runway, blast shelters, hangars, and control deck |
| Beacon Cliffs | 92 × 90 | Signal cliffs facing a crossing with lower coastal routes |
| Glacier Pass | 96 × 92 | Ice traverse, sheltered underpass, and broken snow ridges |
| Windfarm Heights | 100 × 100 | Turbine foundations, service platforms, and diagonal firing lanes |
| Dry Reservoir | 96 × 90 | Drained basin, three-gate spillway, and raised service banks |
| Hedge Maze | 88 × 88 | Looping garden passages, pavilion, and raised lookouts |
| Cargo Grid | 96 × 84 | Staggered freight stacks, crane bridge, and loading lanes |
| Drainworks | 88 × 92 | Water channels, pump galleries, and a walkable weir |
| Rooftop Block | 92 × 88 | Plant-room roofs and service cores above open sky alleys |
| Corn Maze | 88 × 96 | Harvested cross paths, corn rows, timber decks, and wind marker |
| Neon Lanes | 88 × 88 | Night-market alleys, kiosks, and a central skybridge |

## Earlier arenas

The original four egg-world arenas and sixteen historically inspired landscapes remain in the rotation. The historical names describe fictional arenas, not reconstructions of real sites. Their scenery borrows broad features such as terrain, building materials, waterworks and street patterns; no site plan, monument model, photograph or third-party game map is copied.

| Arena | Setting reference | Layout idea |
| --- | --- | --- |
| Barnyard Brawl | Original egg-world farm | Barn, coops and hayloft |
| Countertop | Original egg-world kitchen | Sink canyon and spoon bridge |
| The Hatchery | Original egg-world factory | Catwalk ring and central pit |
| Sunrise Diner | Original egg-world roadside diner | Booths, roof and parking lot |
| Rose Gorge | [Petra, Jordan](https://whc.unesco.org/en/list/326) | Sandstone gorge, ledges and water channels |
| Cloud Terrace | [Machu Picchu, Peru](https://whc.unesco.org/en/list/274) | Mountain terraces and switchbacks |
| Reservoir Grove | [Angkor, Cambodia](https://whc.unesco.org/en/list/668) | Forest, reservoirs and causeways |
| Tuff Labyrinth | [Cappadocia, Türkiye](https://whc.unesco.org/en/list/357) | Tuff outcrops and sheltered passages |
| Boulder Bazaar | [Hampi, India](https://whc.unesco.org/en/list/241) | Boulder field and market street |
| Granite Ring | [Great Zimbabwe, Zimbabwe](https://whc.unesco.org/en/list/364/) | Dry-stone enclosure and curved routes |
| Mesa Alcove | [Mesa Verde, United States](https://whc.unesco.org/en/list/27) | Mesa rim and sheltered alcoves |
| Ash Quarter | [Pompeii, Italy](https://whc.unesco.org/en/list/829/) | Paved streets and courtyard shortcuts |
| Riverbend Plain | [Bagan, Myanmar](https://whc.unesco.org/en/list/1588/) | River plain and low brick forms |
| Basalt Channels | [Nan Madol, Micronesia](https://whc.unesco.org/en/list/1503/) | Basalt islets and channel crossings |
| Highland Caravan | [Aksum, Ethiopia](https://whc.unesco.org/en/list/15) | Highland trade road and stone square |
| Atlantic Outpost | [L’Anse aux Meadows, Canada](https://whc.unesco.org/en/list/4) | Turf settlement and rocky coast |
| Forest Causeway | [Tikal, Guatemala](https://whc.unesco.org/en/list/64) | Raised roads and rainforest plaza |
| Monolith Gardens | [Sigiriya, Sri Lanka](https://whc.unesco.org/en/list/202) | Granite heights and garden paths |
| Volcanic Coast | [Rapa Nui, Chile](https://whc.unesco.org/en/list/715) | Volcanic quarry and coastal track |
| Coral Port | [Kilwa Kisiwani, Tanzania](https://whc.unesco.org/en/list/144/) | Coral-stone streets and quay |

The cultural references above informed scenery only. Navigation, cover, spawning, nests, pickups and routes are authored for Yolkout's three modes. `scripts/mapgen/` is the source for geometry; `make maps` generates the shared JSON and checks floor coverage, spawn placement, direct spawn sightlines, bidirectional objective reachability, and large one-way play areas.

## Design research for the larger arenas

- [Epic's multiplayer level design guidance](https://dev.epicgames.com/documentation/fortnite/level-design-best-practices-in-fortnite-creative) informed readable routes, identifiable landmarks, balanced cover, and avoiding dead ends or dominant camping spots.
- [Epic's level blockout guide](https://dev.epicgames.com/documentation/unreal-engine/designer-01-project-setup-and-level-blockout-in-unreal-engine) informed the checks for scale, verticality, occlusion, and spawn visibility.
- Riot's accounts of [Split's creation](https://playvalorant.com/en-us/news/dev/the-creation-of-split/) and [map environment art](https://playvalorant.com/en-gb/news/dev/the-art-of-valorant-map-environments/) informed distinct gameplay goals per map, counterplay to elevated positions, collision clarity, and restrained scenery.
- Broad outdoor scenery cues came from National Park Service material on [coast redwoods](https://home.nps.gov/articles/000/coast-redwood.htm), [tidal marsh boardwalks](https://home.nps.gov/places/information-panel-boardwalk-to-tidal-marsh.htm), and [barrier islands](https://www.nps.gov/guis/learn/nature/barrierislands.htm). No real-world campsite or game map layout was copied.

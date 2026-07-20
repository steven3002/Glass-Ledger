package catalog

import (
	"math/big"
	"os"
	"strings"
)

// The catalog this scenario mints, written down rather than inferred.
//
// Every id, name, size and price below is a decision somebody made about goods that do not exist yet,
// which is exactly why it is a literal in a file and not something derived from the chain afterwards.
// s13 retired the old "same creator, same price ⇒ same product" heuristic for precisely this reason:
// one product priced differently in two towns came out as two products, and two unrelated products
// that happened to cost the same came out as one.
//
// The shape is the shop's, and the chain never sees any of it except the item ids:
//
//	line → product → variant (a size) → unit (a real item id, in a real consignment)

type Line struct {
	// slug is the collection id in the catalog, and the prefix for every id under it.
	Slug        string
	Name        string
	CreatorName string
	Category    string
	Blurb       string
	// creatorKey indexes CREATOR_KEYS; each line's creator registers once and owns every
	// consignment beneath it.
	CreatorKey int
	Products   []Product
}

type Product struct {
	Slug     string
	Name     string
	Blurb    string
	Variants []Variant
}

type Variant struct {
	Slug string
	// name is the size or format — "50 ml", "XL". A product sold one way still gets one of these
	// rather than a null, because a field that is sometimes absent is a special case every reader
	// has to remember.
	Name string
	// stock is how many units sit in each place, and what they cost there.
	//
	// The same variant may be dearer in one town than another. That is ordinary retail and it is the
	// single fact the retired heuristic could not express.
	Stock []Placement
}

type Placement struct {
	// place indexes LOCATIONS.
	Place int
	// units is how many tagged items to mint here.
	Units int
	// naira is the price *at this location*, in whole naira.
	Naira int64
}

// LOCATIONS are all Nigerian, and that is a constraint rather than a theme.
//
// The owner asked for London and Los Angeles. Both were dropped once the treasury was read properly:
// `Pool` is one asset, one currency, and never converts, so a debt in sterling can be minted and aged
// and claimed — and then `coverDefault` reverts `WrongCurrency`, no stranger can collect, and the
// fund cannot pay. A foreign-currency shop would render beside a Lagos one displaying a guarantee it
// does not have. See dtl1/scope/s14.md; it blocks production, not this demo.
var LOCATIONS = []string{
	"Lagos - Ikoyi",
	"Abuja - Wuse 2",
	"Port Harcourt - GRA",
	"Kano - Nassarawa",
}

// anvilCreatorKeys are anvil's accounts 6, 7 and 8 — deterministic, publicly known, worth nothing.
//
// Fine on a development chain and **not fine on a public one**, which is the whole reason CreatorKeys
// exists below. A creator's key is her identity here: every voucher under her line is checked against
// it, and the claim the shop makes is that nobody but her can make a genuine tag. Sign her goods on a
// public chain with a key printed in anvil's startup banner and that claim is theatre — any passer-by
// can mint a perfect forgery of her work and the registry will confirm it. They are three keys rather
// than one for the same reason: three lines signed by one key is one creator wearing three names.
var anvilCreatorKeys = []string{
	"0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
	"0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
	"0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
}

// CreatorKeys are the keys the catalog's three creators sign with.
//
// From GLASS_CATALOG_KEYS when it is set — three comma-separated private keys, which is how a public
// chain gets creators whose signatures actually mean something. Falls back to anvil's well-known
// accounts, so a local run needs no setup and no secret.
//
// The fallback is deliberately not silent about which it is: `Provenance` says so, and the seeder
// prints it. "Which key signed this" is the single question this system exists to answer, and a run
// that answered it with a publicly-known key without saying so would be the worst possible bug —
// invisible, and fatal to the only claim being made.
func CreatorKeys() []string {
	if set := os.Getenv("GLASS_CATALOG_KEYS"); set != "" {
		keys := strings.Split(set, ",")
		for i := range keys {
			keys[i] = strings.TrimSpace(keys[i])
		}
		if len(keys) >= len(anvilCreatorKeys) {
			return keys
		}
	}
	return anvilCreatorKeys
}

// Provenance describes where the creators' keys came from, for the seeder to print.
func Provenance() string {
	if os.Getenv("GLASS_CATALOG_KEYS") != "" {
		return "GLASS_CATALOG_KEYS (private to this deployment)"
	}
	return "anvil's well-known accounts 6-8 — PUBLIC KEYS, development chains only"
}

// naira turns whole naira into the token's 18-decimal units.
func Naira(whole int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(whole), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
}

// CATALOG — five lines from three creators.
//
// Deliberately uneven: one creator carries two lines, quantities differ, some products are sold in one
// town and some in three, and prices move between places. A seed where everything is symmetrical
// tests nothing, because every bug that only shows up on the ragged edge stays hidden.
var CATALOG = []Line{
	{
		Slug: "harmattan-house", Name: "Harmattan House", CreatorName: "Zainab Bello",
		Category: "Fragrance", CreatorKey: 0,
		Blurb: "Dry-season perfumery out of Kano — resin, dust and cold morning air, bottled in the weeks the wind actually blows.",
		Products: []Product{
			{Slug: "cold-morning", Name: "Cold Morning", Blurb: "Mineral, almost cold to smell. The one everybody starts with.",
				Variants: []Variant{
					{Slug: "50", Name: "50 ml", Stock: []Placement{{3, 3, 42000}, {1, 2, 46000}}},
					{Slug: "100", Name: "100 ml", Stock: []Placement{{3, 2, 74000}}},
				}},
			{Slug: "dust-amber", Name: "Dust & Amber", Blurb: "Amber carried on something powdery. Argued about more than it is bought.",
				Variants: []Variant{
					{Slug: "50", Name: "50 ml", Stock: []Placement{{3, 2, 48000}, {0, 1, 55000}}},
				}},
			{Slug: "kano-indigo", Name: "Kano Indigo", Blurb: "The dye pits, at the hour they are emptied.",
				Variants: []Variant{
					{Slug: "100", Name: "100 ml", Stock: []Placement{{3, 2, 88000}}},
				}},
			{Slug: "dry-grass", Name: "Dry Grass", Blurb: "Cut grass left in the sun until it turns to hay.",
				Variants: []Variant{
					{Slug: "50", Name: "50 ml", Stock: []Placement{{3, 1, 39000}}},
					{Slug: "100", Name: "100 ml", Stock: []Placement{{3, 1, 68000}, {1, 1, 72000}}},
				}},
			{Slug: "night-wind", Name: "Night Wind", Blurb: "The last thing she made before the season turned.",
				Variants: []Variant{
					{Slug: "100", Name: "100 ml", Stock: []Placement{{3, 1, 120000}}},
				}},
		},
	},
	{
		Slug: "wuse-tailors", Name: "Wuse Tailors", CreatorName: "Ibrahim Danjuma",
		Category: "Fashion", CreatorKey: 1,
		Blurb: "Cut and finished in Wuse 2. Sizes are made to a person, not to a chart, which is why the same shirt costs differently at each end of the run.",
		Products: []Product{
			{Slug: "market-shirt", Name: "Market Shirt", Blurb: "Heavy cotton, cut square. The house's whole argument in one garment.",
				Variants: []Variant{
					{Slug: "m", Name: "M", Stock: []Placement{{1, 3, 34000}}},
					{Slug: "l", Name: "L", Stock: []Placement{{1, 2, 36000}, {0, 2, 39000}}},
					{Slug: "xl", Name: "XL", Stock: []Placement{{1, 2, 38000}}},
					{Slug: "xxl", Name: "XXL", Stock: []Placement{{1, 1, 41000}}},
				}},
			{Slug: "wuse-trouser", Name: "Wuse Trouser", Blurb: "Straight leg, deep pocket, no lining.",
				Variants: []Variant{
					{Slug: "l", Name: "L", Stock: []Placement{{1, 2, 52000}}},
					{Slug: "xl", Name: "XL", Stock: []Placement{{1, 2, 55000}, {2, 1, 58000}}},
				}},
			{Slug: "agbada-light", Name: "Agbada, Light", Blurb: "The formal one, in a weight you can wear in April.",
				Variants: []Variant{
					{Slug: "l", Name: "L", Stock: []Placement{{1, 1, 190000}}},
					{Slug: "xl", Name: "XL", Stock: []Placement{{1, 1, 198000}}},
				}},
			{Slug: "wrapper-set", Name: "Wrapper Set", Blurb: "Two pieces, woven to order.",
				Variants: []Variant{
					{Slug: "one", Name: "one size", Stock: []Placement{{1, 2, 88000}, {2, 1, 92000}}},
				}},
			{Slug: "day-cap", Name: "Day Cap", Blurb: "The cheap thing that keeps the lights on.",
				Variants: []Variant{
					{Slug: "one", Name: "one size", Stock: []Placement{{1, 4, 12000}}},
				}},
		},
	},
	{
		Slug: "gra-leather", Name: "GRA Leather", CreatorName: "Ibrahim Danjuma",
		Category: "Leather", CreatorKey: 1,
		Blurb: "A second line, from the same hands: vegetable-tanned hide, sold only out of Port Harcourt.",
		Products: []Product{
			{Slug: "river-tote", Name: "River Tote", Blurb: "One piece of hide, folded twice, stitched once.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{2, 3, 96000}}}}},
			{Slug: "harbour-satchel", Name: "Harbour Satchel", Blurb: "Squarer, heavier, and it will outlive you.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{2, 2, 145000}}}}},
			{Slug: "card-sleeve", Name: "Card Sleeve", Blurb: "Offcuts, put to work.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{2, 4, 15000}}}}},
			{Slug: "belt-plain", Name: "Plain Belt", Blurb: "Brass buckle, no stamp.",
				Variants: []Variant{{Slug: "m", Name: "M", Stock: []Placement{{2, 2, 28000}}},
					{Slug: "l", Name: "L", Stock: []Placement{{2, 2, 28000}}}}},
			{Slug: "work-apron", Name: "Work Apron", Blurb: "Made for the bench it was cut on.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{2, 1, 64000}}}}},
		},
	},
	{
		Slug: "ikoyi-ceramics", Name: "Ikoyi Ceramics", CreatorName: "Folasade Adeyemi",
		Category: "Home & Lifestyle", CreatorKey: 2,
		Blurb: "Thrown and fired in Lagos. Every piece is one of a run, and the run is small enough that the runs differ.",
		Products: []Product{
			{Slug: "lagoon-bowl", Name: "Lagoon Bowl", Blurb: "Glazed the colour the water actually is, not the colour it is painted.",
				Variants: []Variant{{Slug: "s", Name: "small", Stock: []Placement{{0, 3, 22000}}},
					{Slug: "l", Name: "large", Stock: []Placement{{0, 2, 41000}, {1, 1, 44000}}}}},
			{Slug: "ash-vase", Name: "Ash Vase", Blurb: "Wood-ash glaze, which is why no two are the same colour.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 2, 76000}}}}},
			{Slug: "table-set", Name: "Table Set", Blurb: "Four plates that were fired together and should stay together.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 1, 155000}}}}},
			{Slug: "morning-cup", Name: "Morning Cup", Blurb: "Thick walled, small handle, holds heat.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 4, 9500}}}}},
			{Slug: "salt-dish", Name: "Salt Dish", Blurb: "The smallest thing the kiln will take.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 2, 6500}}}}},
		},
	},
	{
		Slug: "adire-works", Name: "Adire Works", CreatorName: "Folasade Adeyemi",
		Category: "Fashion", CreatorKey: 2,
		Blurb: "Resist-dyed cloth, sold in Lagos and Abuja. The second line, and the one that actually moves.",
		Products: []Product{
			{Slug: "indigo-wrapper", Name: "Indigo Wrapper", Blurb: "The pattern the workshop is known for.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 3, 58000}, {1, 2, 62000}}}}},
			{Slug: "resist-scarf", Name: "Resist Scarf", Blurb: "Lighter, and it takes the dye differently.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 2, 24000}}}}},
			{Slug: "kampala-shirt", Name: "Kampala Shirt", Blurb: "Cut from the same cloth, made to be worn out.",
				Variants: []Variant{{Slug: "l", Name: "L", Stock: []Placement{{0, 2, 47000}}},
					{Slug: "xl", Name: "XL", Stock: []Placement{{0, 1, 49000}}}}},
			{Slug: "dye-panel", Name: "Dye Panel", Blurb: "Sold as cloth, bought as art.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 1, 130000}}}}},
			{Slug: "stitch-bag", Name: "Stitch Bag", Blurb: "Offcuts again — every workshop has a thing it makes from offcuts.",
				Variants: []Variant{{Slug: "one", Name: "one size", Stock: []Placement{{0, 2, 18000}}}}},
		},
	},
}

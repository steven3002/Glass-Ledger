// Package index is the catalog indexer: the part of a shop that the chain has no business holding.
//
// The contract accounts for items one at a time and knows no grouping at all. It cannot say that two
// bottles are the same perfume in two sizes, or that a run of items is a line called Àṣẹ Atelier —
// and it should not, because that is editorial. Somebody decides it, it changes without any state
// changing, and putting it on chain would be paying gas to store an opinion.
//
// The shape is the one every shop already has, batched to on-chain proof:
//
//	collection      a creator's line                     editorial
//	  product       an identity — "Burnt Wood"           editorial
//	    variant     a size or format — XL, 50 ml         editorial
//	      unit      one tagged item id on chain          THE JOIN
//
// A variant is not a different item. XL and XXL of one design are the same product wearing different
// sizes; the shop sells "Burnt Wood" and the size is how you pick which one. The contract disagrees —
// to it every unit is an unrelated item with its own id — and that disagreement is the entire reason
// this layer exists off chain.
//
// The split is strict in one direction:
//
//	the indexer says   which items are grouped, what the group is called, which size each one is
//	the chain says     price, state, owner, location, and everything that ever happened
//
// Nothing here stores a price, a stock count or an item's state. That is not an oversight to be
// corrected later — a catalog that carried its own prices would be a second source of truth about
// money, and the entire product is an argument against having one of those. Where the index and the
// chain would disagree, there is nothing to disagree with.
package index

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Schema is created on boot rather than through a migration tool.
//
// There is one writer, the seeder, and the whole database is derived: it can be dropped and rebuilt
// from the scenario definition plus the chain in seconds. A migration framework exists to protect
// data you cannot regenerate, and none of this qualifies.
const Schema = `
-- Every key here is composite on chain_id, and that is not tidiness.
--
-- A catalog belongs to a chain. The same line, with the same slug, legitimately exists on the local
-- development chain and on 0G at the same time — they are different shops that happen to share a
-- name. A globally unique id says otherwise and refuses the second one, which is exactly what it did
-- the first time this ran against two chains.
create table if not exists collections (
    chain_id     bigint      not null,
    id           text        not null,
    creator_id   bigint      not null,
    name         text        not null,
    creator_name text        not null,
    category     text        not null,
    blurb        text        not null,
    position     integer     not null default 0,
    primary key (chain_id, id)
);

create table if not exists products (
    chain_id      bigint  not null,
    id            text    not null,
    collection_id text    not null,
    name          text    not null,
    blurb         text    not null,
    position      integer not null default 0,
    primary key (chain_id, id),
    foreign key (chain_id, collection_id) references collections(chain_id, id) on delete cascade
);

-- A size, a format, a fit. One product has at least one.
--
-- Products that come only one way still get a row here rather than a null: a variant that sometimes
-- exists and sometimes does not is a join every reader has to special-case, and the special case is
-- always the one somebody forgets.
create table if not exists variants (
    chain_id   bigint  not null,
    id         text    not null,
    product_id text    not null,
    name       text    not null,
    position   integer not null default 0,
    primary key (chain_id, id),
    foreign key (chain_id, product_id) references products(chain_id, id) on delete cascade
);

-- The join that does the actual work: a chain item id, and which variant it is one of.
--
-- A row here is the whole claim the indexer makes about item 1001 — "it is an XL of Burnt Wood, in
-- the Ikoyi consignment" — and everything else about 1001 is answered by the chain.
--
-- The tranche id is stored because it is what the chain will be asked for the location, and because
-- an unsold item's own slot does not name its tranche: the state machine writes that lazily, on first
-- touch. Without it the catalog could not say where an unsold unit stands, which is most of them.
create table if not exists units (
    chain_id   bigint not null,
    item_id    bigint not null,
    variant_id text   not null,
    tranche_id bigint not null default 0,
    primary key (chain_id, item_id),
    foreign key (chain_id, variant_id) references variants(chain_id, id) on delete cascade
);

create index if not exists units_variant_idx       on units (chain_id, variant_id);
create index if not exists variants_product_idx    on variants (chain_id, product_id);
create index if not exists products_collection_idx on products (chain_id, collection_id);
`

// Migrate creates the schema if it is not already there.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, Schema)
	return err
}

package index

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Unit is one tagged item on chain, as the catalog refers to it.
//
// An id and the consignment it belongs to, and nothing else. The temptation is to cache a price or a
// state alongside it so the frontend needs one fetch instead of two — and that is exactly the trade
// this refuses, because a cached price is a price that can be wrong while looking authoritative.
type Unit struct {
	ItemID    int64 `json:"itemId"`
	TrancheID int64 `json:"trancheId"`
}

// Variant is a size or a format: XL, XXL, 50 ml.
//
// Not a different product. The shop sells "Burnt Wood"; the size is how a buyer picks which one of
// them to take home. The contract has no such notion — each unit under here is, to it, an unrelated
// item that happens to share a name in a database it cannot read.
type Variant struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Units []Unit `json:"units"`
}

// Product is an identity — "Burnt Wood" — sold in one or more variants.
type Product struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Blurb    string    `json:"blurb"`
	Variants []Variant `json:"variants"`
}

// Collection is a creator's line.
type Collection struct {
	ID          string    `json:"id"`
	CreatorID   int64     `json:"creatorId"`
	Name        string    `json:"name"`
	CreatorName string    `json:"creatorName"`
	Category    string    `json:"category"`
	Blurb       string    `json:"blurb"`
	Products    []Product `json:"products"`
}

// Catalog is the whole index, as the frontend consumes it.
type Catalog struct {
	ChainID     int64        `json:"chainId"`
	Collections []Collection `json:"collections"`
}

// Load reads the entire catalog for one chain.
//
// Four flat queries assembled in memory rather than one join with nested aggregation: the whole
// catalog is a few hundred rows, the shapes stay obvious, and "efficient" at this size means one
// round trip per table — not a clever query nobody can read six months from now.
func Load(ctx context.Context, pool *pgxpool.Pool, chainID int64) (Catalog, error) {
	catalog := Catalog{ChainID: chainID, Collections: []Collection{}}

	collections := map[string]*Collection{}
	var collectionOrder []string

	rows, err := pool.Query(ctx, `
        select id, creator_id, name, creator_name, category, blurb
          from collections
         where chain_id = $1
         order by position, id`, chainID)
	if err != nil {
		return catalog, fmt.Errorf("collections: %w", err)
	}
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.CreatorID, &c.Name, &c.CreatorName, &c.Category, &c.Blurb); err != nil {
			rows.Close()
			return catalog, fmt.Errorf("scan collection: %w", err)
		}
		c.Products = []Product{}
		collections[c.ID] = &c
		collectionOrder = append(collectionOrder, c.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return catalog, err
	}

	products := map[string]*Product{}
	var productOrder []string
	inCollection := map[string]string{}

	rows, err = pool.Query(ctx, `
        select id, collection_id, name, blurb
          from products
         where chain_id = $1
         order by position, id`, chainID)
	if err != nil {
		return catalog, fmt.Errorf("products: %w", err)
	}
	for rows.Next() {
		var p Product
		var collectionID string
		if err := rows.Scan(&p.ID, &collectionID, &p.Name, &p.Blurb); err != nil {
			rows.Close()
			return catalog, fmt.Errorf("scan product: %w", err)
		}
		p.Variants = []Variant{}
		products[p.ID] = &p
		inCollection[p.ID] = collectionID
		productOrder = append(productOrder, p.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return catalog, err
	}

	variants := map[string]*Variant{}
	var variantOrder []string
	inProduct := map[string]string{}

	rows, err = pool.Query(ctx, `
        select id, product_id, name
          from variants
         where chain_id = $1
         order by position, id`, chainID)
	if err != nil {
		return catalog, fmt.Errorf("variants: %w", err)
	}
	for rows.Next() {
		var v Variant
		var productID string
		if err := rows.Scan(&v.ID, &productID, &v.Name); err != nil {
			rows.Close()
			return catalog, fmt.Errorf("scan variant: %w", err)
		}
		v.Units = []Unit{}
		variants[v.ID] = &v
		inProduct[v.ID] = productID
		variantOrder = append(variantOrder, v.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return catalog, err
	}

	rows, err = pool.Query(ctx, `
        select item_id, variant_id, tranche_id
          from units
         where chain_id = $1
         order by item_id`, chainID)
	if err != nil {
		return catalog, fmt.Errorf("units: %w", err)
	}
	for rows.Next() {
		var u Unit
		var variantID string
		if err := rows.Scan(&u.ItemID, &variantID, &u.TrancheID); err != nil {
			rows.Close()
			return catalog, fmt.Errorf("scan unit: %w", err)
		}
		if v, ok := variants[variantID]; ok {
			v.Units = append(v.Units, u)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return catalog, err
	}

	for _, id := range variantOrder {
		if p, ok := products[inProduct[id]]; ok {
			p.Variants = append(p.Variants, *variants[id])
		}
	}
	for _, id := range productOrder {
		if c, ok := collections[inCollection[id]]; ok {
			c.Products = append(c.Products, *products[id])
		}
	}
	for _, id := range collectionOrder {
		catalog.Collections = append(catalog.Collections, *collections[id])
	}
	return catalog, nil
}

// Placement is where one unit sits in the catalog — the reverse lookup an item dossier asks for.
type Placement struct {
	Collection Collection `json:"collection"`
	Product    Product    `json:"product"`
	Variant    Variant    `json:"variant"`
}

// FindItem answers: what is this unit, and whose line is it in?
func FindItem(ctx context.Context, pool *pgxpool.Pool, chainID, itemID int64) (*Placement, error) {
	var p Placement
	err := pool.QueryRow(ctx, `
        select c.id, c.creator_id, c.name, c.creator_name, c.category, c.blurb,
               pr.id, pr.name, pr.blurb,
               v.id, v.name
          from units u
          join variants    v  on v.chain_id = u.chain_id and v.id  = u.variant_id
          join products    pr on pr.chain_id = v.chain_id and pr.id = v.product_id
          join collections c  on c.chain_id  = pr.chain_id and c.id = pr.collection_id
         where u.chain_id = $1 and u.item_id = $2`, chainID, itemID).
		Scan(&p.Collection.ID, &p.Collection.CreatorID, &p.Collection.Name, &p.Collection.CreatorName,
			&p.Collection.Category, &p.Collection.Blurb,
			&p.Product.ID, &p.Product.Name, &p.Product.Blurb,
			&p.Variant.ID, &p.Variant.Name)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

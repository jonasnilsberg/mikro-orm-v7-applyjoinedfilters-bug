# MikroORM v7 `applyJoinedFilters` + `autoJoinRefsForFilters: false` — `errorMissingRTE`

Minimal reproduction of a MikroORM v7 bug where `applyJoinedFilters()` places filter conditions in a join ON clause that references a table alias defined in a **later** join, causing `missing FROM-clause entry for table "l2"` (`errorMissingRTE`).

## Root Cause

When `autoJoinRefsForFilters: false` is set in the ORM config, and an entity has a `@Filter` whose condition references a relation (e.g., `{ $or: [{ id: [...] }, { locations: [...] }] }`), and a query auto-joins that entity, `applyJoinedFilters()` applies the filter in the join ON clause. However, the relation referenced in the filter condition (`locations`) creates a **secondary join** that is added to the FROM clause **after** the primary join. This creates a forward reference: the ON clause of the first join references an alias from the second join.

### The Bug in Detail

1. Entity `Product` has M:1 to `Company`
2. `Company` has a `@Filter` with `{ $or: [{ id: [...] }, { locations: [...] }] }` where `locations` is a O:M relation
3. Query: `em.find(Product, { company: { code: 'ACME' } })` — auto-joins `Company`
4. `applyJoinedFilters` applies Company's filter in the Company join ON clause
5. The `{ locations: [...] }` part survives the stripping logic (arrays are not plain objects)
6. `CriteriaNode.process()` creates a secondary join for `Location` (alias `l2`)
7. **With `autoJoinRefsForFilters: false`**, the `l2` join is added **after** the `c1` (Company) join
8. The `c1` join ON clause references `l2.id`, but `l2` hasn't been defined yet
9. PostgreSQL: `missing FROM-clause entry for table "l2"`

### Generated SQL (buggy)

```sql
select "p0".*
from "product" as "p0"
inner join "company" as "c1" on "p0"."company_id" = "c1"."id"
  and ("c1"."id" in ('company-1') or "l2"."id" in ('loc-1'))  -- ❌ l2 not yet defined
left join "location" as "l2" on "c1"."id" = "l2"."company_id"  -- l2 defined here, too late
where "c1"."code" = 'ACME'
```

### With `autoJoinRefsForFilters: true` (default — works correctly)

```sql
select "p0".*, "c1"."id" as "c1__id"
from "product" as "p0"
inner join "company" as "c1" on "p0"."company_id" = "c1"."id"
  and "c1"."id" in ('company-1')
left join "location" as "l2" on "c1"."id" = "l2"."company_id"  -- ✅ l2 defined before use
  and "l2"."id" in ('loc-1')
where "c1"."code" = 'ACME'
```

With the default `autoJoinRefsForFilters: true`, the filter condition is placed in the Location join ON clause (not the Company join ON clause), and the Location join is added to FROM before it's referenced.

## Key Setting

```ts
await MikroORM.init({
  // ...
  autoJoinRefsForFilters: false,  // <-- triggers the bug
});
```

## Reproduction

```bash
pnpm install
createdb mikro_orm_v7_bug_repro
pnpm test
```

This compiles with `--skipLibCheck` (to avoid a known TS2419 driver type mismatch in MikroORM v7's typings) and runs the compiled JS, which correctly emits decorator metadata.

Expected output:
```
❌ Query failed: missing FROM-clause entry for table "l2"
```

## Versions

- `@mikro-orm/core`: 7.1.7
- `@mikro-orm/postgresql`: 7.1.7
- `@mikro-orm/decorators`: 7.1.7
- TypeScript: 5.9.3
- Node.js: 22.x
- PostgreSQL: 14+

## Files

- `src/entities.ts` — Entity definitions: `Product` (M:1 → `Company`), `Company` (O:M → `Location`, has `@Filter`)
- `src/index.ts` — Reproduction script with `autoJoinRefsForFilters: false`
- `tsconfig.json` — TypeScript config with experimental decorators

## Analysis

The bug is in `QueryBuilder.applyJoinedFilters()` ([QueryBuilder.js line ~405](https://github.com/mikro-orm/mikro-orm/blob/master/packages/sql/src/query/QueryBuilder.ts#L405)). The method:

1. Iterates over `autoJoinedPaths`
2. For each path, applies the target entity's filters
3. Processes the filter through `CriteriaNode.process()`, which may create secondary joins
4. Strips nested relation-path filters from the join ON condition (but fails for arrays and `$or`)
5. Sets the join condition

The stripping logic (line ~420) is supposed to remove relation-path filters, keeping only scalars:

```js
for (const key of Object.keys(cond)) {
    if (Utils.isPlainObject(cond[key]) &&
        Object.keys(cond[key]).every(k => !(Utils.isOperator(k) && !['$some','$none','$every','$size'].includes(k)))) {
        delete cond[key];
    }
}
```

This fails to strip:
- `{ locations: ['loc-1'] }` — arrays are not plain objects (`isPlainObject([])` = false)
- `{ $or: [...] }` — arrays are not plain objects

The surviving filter condition causes `CriteriaNode.process()` to create a secondary join. With `autoJoinRefsForFilters: false`, this secondary join is placed **after** the primary join, creating a forward reference in the ON clause.

### Possible Fixes

1. **Fix the stripping logic** to also handle arrays and `$or`/`$and` operators
2. **Fix the join ordering** so secondary joins from filter conditions are always placed before the primary join that references them
3. **Document the interaction** between `autoJoinRefsForFilters: false` and `@Filter` conditions that reference relations

# MikroORM v7 `applyJoinedFilters` Bug — `errorMissingRTE`

Minimal reproduction of a MikroORM v7 bug where `QueryBuilder.applyJoinedFilters()` fails to strip relation-path filter conditions containing operators (`$in`, `$eq`) from join ON clauses, causing `missing FROM-clause entry for table "c3"` (`errorMissingRTE`).

## Bug Summary

When an entity has a `@Filter` whose condition references a relation via an operator (e.g., `{ company: { $in: companyIds } }`), and a query auto-joins that same relation, MikroORM v7's `applyJoinedFilters` method attempts to push the filter condition into the join ON clause. However, the filter stripping logic fails to remove conditions with operators like `$in`, causing the surviving filter to trigger a duplicate auto-join (alias `c3`) that is not added to the FROM clause.

### Root Cause

In `QueryBuilder.applyJoinedFilters()` ([QueryBuilder.js line ~420](https://github.com/mikro-orm/mikro-orm/blob/master/packages/sql/src/query/QueryBuilder.ts#L405)):

```js
// remove nested filters, we only care about scalars here
for (const key of Object.keys(cond)) {
    if (Utils.isPlainObject(cond[key]) &&
        Object.keys(cond[key]).every(k => !(Utils.isOperator(k) && !['$some', '$none', '$every', '$size'].includes(k)))) {
        delete cond[key];
    }
}
```

For `{ company: { $in: companyIds } }`:
- `cond[key]` = `{ $in: companyIds }` — is a plain object ✅
- `Object.keys(cond[key])` = `['$in']`
- `Utils.isOperator('$in')` = `true`
- `!['$some', '$none', '$every', '$size'].includes('$in')` = `true`
- `!(true && true)` = `false`
- `.every()` returns `false`
- The key is **NOT deleted** ❌

The surviving `{ company: { $in: companyIds } }` causes `CriteriaNode.process()` to try auto-joining `company` again, creating a new alias (e.g., `c3`) that's not in the FROM clause.

### Conditions That Trigger the Bug

1. Entity A has a `@Filter` with a condition referencing a relation via an operator: `{ company: { $in: [...] } }`
2. A query on entity A (or entity B that joins A) auto-joins the same relation: `{ company: { code: 'X' } }`
3. `applyJoinedFilters` runs for the auto-joined path and applies the filter in the join ON clause
4. The stripping logic fails to remove the `$in` condition
5. The surviving condition triggers a duplicate auto-join → `errorMissingRTE`

### Workaround

Use raw SQL fragments with the `[::alias::]` placeholder instead of relation-path filter conditions:

```ts
import { raw } from '@mikro-orm/core';

// Instead of: { company: { $in: companyIds } }
// Use:
{ [raw(`[::alias::].company_id IN (${placeholders})`, companyIds)]: [] }
```

Raw SQL fragments are scalar fragments that survive the stripping logic correctly and don't trigger auto-join.

## Reproduction Status

This repo contains a minimal setup that demonstrates the conditions under which the bug occurs. The bug is confirmed in the real workplace-manager codebase (58+ entities, complex relation graph) but is difficult to reproduce in a minimal standalone setup because it depends on:

1. The filter being defined on the **target** entity of an auto-joined relation (not the root entity)
2. The filter condition using an operator (`$in`) on a relation path
3. The query auto-joining the same relation that the filter references

In simple setups, MikroORM correctly translates `{ company: { $in: [...] } }` to a scalar FK condition (`company_id IN (...)`) without triggering `applyJoinedFilters`. The bug only manifests when the filter is applied to a joined entity in the ON clause context.

## Files

- `src/entities.ts` — Entity definitions with `@Filter`
- `src/index.ts` — Reproduction script
- `tsconfig.json` — TypeScript config with experimental decorators

## Versions

- `@mikro-orm/core`: 7.1.7
- `@mikro-orm/postgresql`: 7.1.7
- `@mikro-orm/decorators`: 7.1.7
- TypeScript: 5.9.3
- Node.js: 22.x

## Running

```bash
pnpm install
# Requires PostgreSQL running on localhost:5432 with user postgres/postgres
createdb mikro_orm_v7_bug_repro
npx tsc --skipLibCheck --noEmitOnError false
node dist/index.js
```

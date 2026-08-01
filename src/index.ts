import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { Company, Location, Product } from './entities';

async function main() {
  const orm = await MikroORM.init({
    entities: [Company, Location, Product],
    dbName: 'mikro_orm_v7_bug_repro',
    driver: PostgreSqlDriver,
    user: 'postgres',
    password: 'postgres',
    host: 'localhost',
    port: 5432,
    debug: ['query', 'query-params'],
    metadataProvider: ReflectMetadataProvider,
  });

  const generator = orm.schema;
  await generator.drop();
  await generator.create();

  const em = orm.em.fork();

  // Seed
  const company1 = em.create(Company, { id: 'company-1', name: 'Acme', code: 'ACME' });
  const company2 = em.create(Company, { id: 'company-2', name: 'Globex', code: 'GLOB' });
  const loc1 = em.create(Location, { id: 'loc-1', name: 'HQ', company: company1 });
  const loc2 = em.create(Location, { id: 'loc-2', name: 'Branch', company: company2 });
  em.create(Product, { id: 'p1', title: 'Widget', company: company1 });
  em.create(Product, { id: 'p2', title: 'Gadget', company: company2 });
  await em.flush();

  // --- Bug trigger: query auto-joins company, applyJoinedFilters applies Company's filter ---
  console.log('\n--- Bug trigger: { company: { code } } + Company auth filter with { locations: [...] } ---\n');

  try {
    const results = await em.find(
      Product,
      { company: { code: 'ACME' } },
      { filters: { auth: true } },
    );
    console.log(`\n✅ Query succeeded: found ${results.length} products`);
  } catch (err: any) {
    console.log(`\n❌ Query failed: ${err.message}`);
    if (err.cause) {
      console.log(`   Cause: ${err.cause.message}`);
    }
  }

  // --- Control: auth filter disabled ---
  console.log('\n--- Control: same query with auth filter disabled ---\n');

  try {
    const results = await em.find(
      Product,
      { company: { code: 'ACME' } },
      { filters: { auth: false } },
    );
    console.log(`\n✅ Query succeeded: found ${results.length} products`);
  } catch (err: any) {
    console.log(`\n❌ Query failed: ${err.message}`);
  }

  await orm.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

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
    autoJoinRefsForFilters: false,  // <-- KEY SETTING from real codebase
  });

  await orm.schema.drop();
  await orm.schema.create();

  const em = orm.em.fork();
  const company1 = em.create(Company, { id: 'company-1', name: 'Acme', code: 'ACME' });
  em.create(Location, { id: 'loc-1', name: 'HQ', company: company1 });
  em.create(Product, { id: 'p1', title: 'Widget', company: company1 });
  await em.flush();

  console.log('\n--- Bug trigger: autoJoinRefsForFilters: false ---\n');
  try {
    const results = await em.find(
      Product,
      { company: { code: 'ACME' } },
      { filters: { auth: true } },
    );
    console.log(`\n✅ Query succeeded: found ${results.length} products`);
  } catch (err: any) {
    console.log(`\n❌ Query failed: ${err.message}`);
  }

  await orm.close();
}

main().catch(err => { console.error(err); process.exit(1); });

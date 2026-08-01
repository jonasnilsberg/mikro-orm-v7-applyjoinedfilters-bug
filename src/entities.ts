import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, Filter } from '@mikro-orm/decorators/legacy';
import { Rel, Collection } from '@mikro-orm/core';

@Entity()
@Filter({
  name: 'auth',
  cond: () => ({ $or: [{ id: ['company-1'] }, { locations: ['loc-1'] }] }),
  default: true,
})
export class Company {
  @PrimaryKey() id!: string;
  @Property() name!: string;
  @Property({ unique: true }) code!: string;
  @OneToMany(() => Location, (l) => l.company)
  locations = new Collection<Location>(this);
}

@Entity()
export class Location {
  @PrimaryKey() id!: string;
  @Property() name!: string;
  @ManyToOne(() => Company) company!: Rel<Company>;
}

@Entity()
export class Product {
  @PrimaryKey() id!: string;
  @Property() title!: string;
  @ManyToOne(() => Company) company!: Rel<Company>;
}

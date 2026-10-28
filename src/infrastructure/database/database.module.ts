import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import { ormOptions } from './orm.options.js';

export const DATABASE_ORM = Symbol('DATABASE_ORM');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_ORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    await this.orm.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_ORM,
      useFactory: async (): Promise<MikroORM> =>
        MikroORM.init(ormOptions),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_ORM],
})
export class DatabaseModule {}

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0055f2532f279509e5d098be55e55131fbf6798e3c9d6439fc4486bdb65b65f9/contract';
import startContract from '../../snapshots/0055f2532f279509e5d098be55e55131fbf6798e3c9d6439fc4486bdb65b65f9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/31d6aa4d4250beb9a8e162a79385c9febe088174edf1a077f3ff074917ddabdf/contract';
import endContract from '../../snapshots/31d6aa4d4250beb9a8e162a79385c9febe088174edf1a077f3ff074917ddabdf/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_role_check_b7d9e498',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_role_check_17d28f90',
        expression: `"role" IN ('CUSTOMER', 'RIDER', 'ADMIN', 'STAFF')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

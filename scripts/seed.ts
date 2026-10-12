import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../src/prisma/db.js';

type SeedUser = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'ADMIN' | 'CUSTOMER' | 'RIDER';
  rider?: {
    vehicleType: string;
    vehiclePlate: string;
    licenseNumber: string;
    city?: string;
    isVerified: boolean;
    availability: 'AVAILABLE' | 'OFFLINE' | 'BUSY';
  };
};

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? 'admin@platform.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin1234!';

const USERS: SeedUser[] = [
  {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    firstName: 'Ada',
    lastName: 'Admin',
    phone: '+15550000001',
    role: 'ADMIN',
  },
  {
    email: 'customer@demo.test',
    password: 'Customer1234!',
    firstName: 'Cara',
    lastName: 'Customer',
    phone: '+15550000002',
    role: 'CUSTOMER',
  },
  {
    email: 'rider@demo.test',
    password: 'Rider1234!',
    firstName: 'Ravi',
    lastName: 'Rider',
    phone: '+15550000003',
    role: 'RIDER',
    rider: {
      vehicleType: 'Motorbike',
      vehiclePlate: 'RD-001',
      licenseNumber: 'LIC-9981',
      city: 'Lagos',
      isVerified: true,
      availability: 'AVAILABLE',
    },
  },
  {
    email: 'rider2@demo.test',
    password: 'Rider1234!',
    firstName: 'Rita',
    lastName: 'Rider',
    phone: '+15550000004',
    role: 'RIDER',
    rider: {
      vehicleType: 'Bicycle',
      vehiclePlate: 'RD-002',
      licenseNumber: 'LIC-9982',
      city: 'Lagos',
      isVerified: true,
      availability: 'OFFLINE',
    },
  },
];

async function seedUser(input: SeedUser): Promise<string> {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const { rider, ...user } = input;

  let row = await db.orm.public.User.first({ email: input.email });
  if (row) {
    const updated = await db.orm.public.User
      .where({ id: row.id })
      .update({
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone ?? null,
        role: user.role,
        status: 'ACTIVE',
        passwordHash,
      });
    row = updated ?? row;
  } else {
    row = await db.orm.public.User.create({
      id: randomUUID(),
      email: user.email,
      passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      role: user.role,
      status: 'ACTIVE',
    });
  }

  if (rider) {
    const existingProfile = await db.orm.public.RiderProfile.first({ userId: row.id });
    if (existingProfile) {
      await db.orm.public.RiderProfile
        .where({ id: existingProfile.id })
        .update({
          vehicleType: rider.vehicleType,
          vehiclePlate: rider.vehiclePlate,
          licenseNumber: rider.licenseNumber,
          city: rider.city ?? null,
          isVerified: rider.isVerified,
          availability: rider.availability,
        });
    } else {
      await db.orm.public.RiderProfile.create({
        id: randomUUID(),
        userId: row.id,
        availability: rider.availability,
        vehicleType: rider.vehicleType,
        vehiclePlate: rider.vehiclePlate,
        licenseNumber: rider.licenseNumber,
        city: rider.city ?? null,
        isVerified: rider.isVerified,
        completedRuns: 0,
      });
    }
  }

  return row.id;
}

async function main(): Promise<void> {
  console.log('Seeding delivery-platform demo accounts...');
  for (const user of USERS) {
    const id = await seedUser(user);
    console.log(`  ✓ ${user.role.padEnd(8)} ${user.email.padEnd(24)} (${id})`);
  }
  console.log('Done. Passwords are printed in scripts/seed.ts.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });

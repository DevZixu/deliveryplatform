import type { RiderProfileRow, UserRow } from '../types/db.js';

export function serializeUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function serializeRiderProfile(profile: RiderProfileRow) {
  return {
    id: profile.id,
    userId: profile.userId,
    availability: profile.availability,
    vehicleType: profile.vehicleType,
    vehiclePlate: profile.vehiclePlate,
    licenseNumber: profile.licenseNumber,
    isVerified: profile.isVerified,
    city: profile.city,
    completedRuns: profile.completedRuns,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function serializeUserWithRider(
  user: UserRow,
  profile?: RiderProfileRow | null,
  extra: Record<string, unknown> = {},
) {
  return {
    ...serializeUser(user),
    ...(profile ? { rider: serializeRiderProfile(profile) } : {}),
    ...extra,
  };
}

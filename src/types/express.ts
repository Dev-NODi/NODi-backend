import type { Company, FleetManager, FleetManagerCompanyAssignment } from '../generated/prisma/client';

export type FleetManagerWithCompanies = FleetManager & {
  companies: (FleetManagerCompanyAssignment & { company: Pick<Company, 'id' | 'name'> })[];
};

declare global {
  namespace Express {
    interface Request {
      fleetManager?: FleetManagerWithCompanies;
    }
  }
}

export {};

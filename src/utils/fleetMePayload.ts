import type { FleetManagerWithCompanies } from '../types/express';

type AssignmentRow = FleetManagerWithCompanies['companies'][number];

/** JSON `data` for GET /fleet/me and PATCH /fleet/me/profile. */
export function buildFleetMePayload(fm: FleetManagerWithCompanies) {
  return {
    id: fm.id,
    firebaseUid: fm.firebaseUid,
    email: fm.email,
    name: fm.name,
    companyName: fm.companyName ?? null,
    contactNumber: fm.contactNumber ?? null,
    companies: fm.companies.map((c: AssignmentRow) => ({
      assignmentId: c.id,
      companyId: c.companyId,
      role: c.role,
      company: c.company,
    })),
  };
}

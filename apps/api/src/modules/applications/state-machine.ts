import { ApplicationStatus } from '@prisma/client';

/**
 * Allowed application transitions. Declared as data so that an illegal move is
 * impossible to express, rather than merely unlikely: services ask this table,
 * and the table is the single definition of the lifecycle.
 */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: [ApplicationStatus.PROFILE_SUBMITTED, ApplicationStatus.WITHDRAWN, ApplicationStatus.EXPIRED],
  PROFILE_SUBMITTED: [
    ApplicationStatus.UNDER_REVIEW,
    ApplicationStatus.WITHDRAWN,
    ApplicationStatus.EXPIRED,
  ],
  UNDER_REVIEW: [
    ApplicationStatus.APPROVED,
    ApplicationStatus.REFERRED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
    ApplicationStatus.EXPIRED,
  ],
  // A referred application is decided by a human, who may approve or reject it.
  REFERRED: [
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
    ApplicationStatus.EXPIRED,
  ],
  APPROVED: [ApplicationStatus.EXPIRED, ApplicationStatus.WITHDRAWN],
  // Terminal. A rejected application is never revived; the customer applies again,
  // which produces a fresh decision under the policy in force at that time.
  REJECTED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export const canTransition = (from: ApplicationStatus, to: ApplicationStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const isTerminal = (status: ApplicationStatus): boolean => TRANSITIONS[status].length === 0;

/** Statuses in which the customer may still edit the application. */
export const isEditable = (status: ApplicationStatus): boolean =>
  status === ApplicationStatus.DRAFT || status === ApplicationStatus.PROFILE_SUBMITTED;

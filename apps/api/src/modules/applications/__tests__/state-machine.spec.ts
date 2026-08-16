import { ApplicationStatus } from '@prisma/client';
import { canTransition, isEditable, isTerminal } from '../state-machine';

describe('application state machine', () => {
  it('allows the origination path and the exits from it', () => {
    expect(canTransition(ApplicationStatus.DRAFT, ApplicationStatus.PROFILE_SUBMITTED)).toBe(true);
    expect(canTransition(ApplicationStatus.PROFILE_SUBMITTED, ApplicationStatus.UNDER_REVIEW)).toBe(true);
    expect(canTransition(ApplicationStatus.UNDER_REVIEW, ApplicationStatus.APPROVED)).toBe(true);
    expect(canTransition(ApplicationStatus.UNDER_REVIEW, ApplicationStatus.REFERRED)).toBe(true);
    expect(canTransition(ApplicationStatus.REFERRED, ApplicationStatus.APPROVED)).toBe(true);
    expect(canTransition(ApplicationStatus.APPROVED, ApplicationStatus.EXPIRED)).toBe(true);
  });

  it('never revives a closed application', () => {
    for (const terminal of [
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
      ApplicationStatus.EXPIRED,
    ]) {
      expect(isTerminal(terminal)).toBe(true);
      for (const target of Object.values(ApplicationStatus)) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('refuses to skip decisioning or to reverse a decision', () => {
    expect(canTransition(ApplicationStatus.DRAFT, ApplicationStatus.APPROVED)).toBe(false);
    expect(canTransition(ApplicationStatus.DRAFT, ApplicationStatus.UNDER_REVIEW)).toBe(false);
    expect(canTransition(ApplicationStatus.PROFILE_SUBMITTED, ApplicationStatus.APPROVED)).toBe(false);
    expect(canTransition(ApplicationStatus.APPROVED, ApplicationStatus.REJECTED)).toBe(false);
    expect(canTransition(ApplicationStatus.APPROVED, ApplicationStatus.UNDER_REVIEW)).toBe(false);
    expect(canTransition(ApplicationStatus.REJECTED, ApplicationStatus.APPROVED)).toBe(false);
  });

  it('permits customer edits only before decisioning starts', () => {
    expect(isEditable(ApplicationStatus.DRAFT)).toBe(true);
    expect(isEditable(ApplicationStatus.PROFILE_SUBMITTED)).toBe(true);
    expect(isEditable(ApplicationStatus.UNDER_REVIEW)).toBe(false);
    expect(isEditable(ApplicationStatus.APPROVED)).toBe(false);
  });
});

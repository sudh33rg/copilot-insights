import { describe, expect, it } from 'vitest';
import { projectMonth } from './projection';

describe('projectMonth', () => {
  it('projects the month linearly from the days elapsed, today included', () => {
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: 30 })).toEqual({
      daysInMonth: 30,
      daysElapsed: 10,
      spent: 12,
      projected: 36,
      status: 'watch',
    });
  });

  it('is on track when the projection stays within the budget', () => {
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: 40 })?.status).toBe('ok');
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: 36 })?.status).toBe('ok');
  });

  it('is over as soon as the spend reaches the budget, even early in the month', () => {
    expect(projectMonth({ today: '2026-09-03', spent: 30, budget: 30 })?.status).toBe('over');
    expect(projectMonth({ today: '2026-09-03', spent: 45, budget: 30 })?.status).toBe('over');
  });

  it('uses one elapsed day on the first of the month', () => {
    expect(projectMonth({ today: '2026-09-01', spent: 3, budget: 500 })).toMatchObject({
      daysElapsed: 1,
      projected: 90,
    });
  });

  it('projects nothing for a month with no usage', () => {
    expect(projectMonth({ today: '2026-09-15', spent: 0, budget: 10 })).toMatchObject({
      projected: 0,
      status: 'ok',
    });
  });

  it('knows the real length of February, leap years included', () => {
    expect(projectMonth({ today: '2028-02-29', spent: 29, budget: 100 })).toMatchObject({
      daysInMonth: 29,
      daysElapsed: 29,
      projected: 29,
    });
    expect(projectMonth({ today: '2027-02-28', spent: 28, budget: 100 })).toMatchObject({
      daysInMonth: 28,
      daysElapsed: 28,
    });
  });

  it('is off without a positive budget', () => {
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: 0 })).toBeNull();
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: -5 })).toBeNull();
    expect(projectMonth({ today: '2026-09-10', spent: 12, budget: Number.NaN })).toBeNull();
  });
});

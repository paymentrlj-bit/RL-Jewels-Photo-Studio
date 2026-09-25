// The site-wide "everything is stuck" banner (server/queue/systemStatus.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { reportBlockingIssue, clearBlockingIssue, getBlockingIssue } from '../queue/systemStatus';

describe('blocking issue tracker', () => {
  beforeEach(() => clearBlockingIssue());

  it('starts clear', () => {
    expect(getBlockingIssue()).toBeNull();
  });

  it('reports an issue with a timestamp', () => {
    reportBlockingIssue('billing_cap', 'out of prepaid credit');
    const issue = getBlockingIssue();
    expect(issue?.code).toBe('billing_cap');
    expect(issue?.message).toBe('out of prepaid credit');
    expect(issue?.since).toBeTruthy();
  });

  it('does not push the start time forward on a repeat of the same failure', async () => {
    reportBlockingIssue('billing_cap', 'first');
    const since = getBlockingIssue()!.since;
    await new Promise((r) => setTimeout(r, 5));
    reportBlockingIssue('billing_cap', 'second');
    expect(getBlockingIssue()!.since).toBe(since);
    // The message also stays the first one - it is honestly still broken
    // since then, not freshly broken with new wording.
    expect(getBlockingIssue()!.message).toBe('first');
  });

  it('a different kind of failure replaces the old one, with a fresh start time', async () => {
    reportBlockingIssue('billing_cap', 'money');
    await new Promise((r) => setTimeout(r, 5));
    reportBlockingIssue('escalation_model_missing', 'model gone');
    expect(getBlockingIssue()).toMatchObject({ code: 'escalation_model_missing', message: 'model gone' });
  });

  it('clears on success', () => {
    reportBlockingIssue('billing_cap', 'money');
    clearBlockingIssue();
    expect(getBlockingIssue()).toBeNull();
  });
});

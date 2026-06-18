import { describe, it, expect } from 'vitest';
import { USER_ROLES, CONNECTION_STATUSES, MESSAGE_ROLES, LOG_STATUSES } from './db-contracts';

// These must match db/schema.sql exactly (values AND order). The Drizzle pgEnums
// consume the same tuples, so a drift here is caught before it reaches the DB.
describe('db enum contracts', () => {
  it('user_role', () => {
    expect(USER_ROLES).toEqual(['owner', 'member']);
  });
  it('connection_status', () => {
    expect(CONNECTION_STATUSES).toEqual(['pending', 'active', 'failed']);
  });
  it('message_role', () => {
    expect(MESSAGE_ROLES).toEqual(['user', 'assistant']);
  });
  it('log_status', () => {
    expect(LOG_STATUSES).toEqual(['success', 'failed']);
  });
});

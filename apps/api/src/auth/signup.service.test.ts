import { describe, it, expect, vi } from 'vitest';
import type { SignupRequest } from '@lumen/shared';
import { createSignupService } from './signup.service';
import type { SignupStore, CreateTenantResult, CreateTenantInput } from './signup.store';
import type { VerificationTrigger } from './verification-trigger';

const input: SignupRequest = {
  email: 'owner@example.com',
  password: 'a-strong-pass-9',
  organizationName: 'Acme',
};

function makeService(result: CreateTenantResult, triggerImpl?: () => Promise<void>) {
  const createTenant = vi.fn(async (_input: CreateTenantInput): Promise<CreateTenantResult> => result);
  const store: SignupStore = { createTenant };
  const triggerForNewUser = vi.fn(triggerImpl ?? (async () => {}));
  const verificationTrigger: VerificationTrigger = { triggerForNewUser };
  const hashPassword = vi.fn(async (plain: string) => `argon2:${plain}`);
  const service = createSignupService({ store, hashPassword, verificationTrigger });
  return { service, createTenant, triggerForNewUser, hashPassword };
}

describe('createSignupService', () => {
  it('happy path: hashes password, creates tenant, triggers verification after commit', async () => {
    const { service, createTenant, triggerForNewUser, hashPassword } = makeService({
      outcome: 'created',
      orgId: 'org-1',
      userId: 'user-1',
    });

    const res = await service.signup(input);

    expect(hashPassword).toHaveBeenCalledWith('a-strong-pass-9');
    expect(createTenant).toHaveBeenCalledWith({
      email: 'owner@example.com',
      passwordHash: 'argon2:a-strong-pass-9',
      organizationName: 'Acme',
    });
    expect(triggerForNewUser).toHaveBeenCalledWith('user-1', 'owner@example.com');
    expect(res.message).toBeTruthy();
  });

  it('never passes the raw password to the store (only the hash)', async () => {
    const { service, createTenant } = makeService({ outcome: 'created', orgId: 'o', userId: 'u' });
    await service.signup(input);
    const arg = createTenant.mock.calls[0]?.[0];
    expect(arg?.passwordHash).not.toBe(input.password);
    expect(arg?.passwordHash).toBe('argon2:a-strong-pass-9');
  });

  it('duplicate email: still hashes, does NOT trigger verification, returns same response', async () => {
    const created = makeService({ outcome: 'created', orgId: 'o', userId: 'u' });
    const duplicate = makeService({ outcome: 'duplicate' });

    const createdRes = await created.service.signup(input);
    const duplicateRes = await duplicate.service.signup(input);

    expect(duplicate.hashPassword).toHaveBeenCalledWith('a-strong-pass-9'); // uniform work
    expect(duplicate.triggerForNewUser).not.toHaveBeenCalled();
    // Anti-enumeration: byte-for-byte identical response for created vs duplicate.
    expect(duplicateRes).toEqual(createdRes);
  });

  it('swallows a verification-trigger failure (tenant already committed)', async () => {
    const { service } = makeService({ outcome: 'created', orgId: 'o', userId: 'u' }, async () => {
      throw new Error('resend exploded');
    });
    await expect(service.signup(input)).resolves.toHaveProperty('message');
  });
});

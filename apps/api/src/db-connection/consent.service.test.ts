import { describe, it, expect, vi } from 'vitest';
import { CURRENT_CONSENT_VERSION } from '@lumen/shared';
import { createConsentService } from './consent.service';
import type { ConsentStore } from './consent.store';

function build(acceptedVersion: string | null) {
  const recordConsent = vi.fn(async (_o: string, _u: string, _v: string) => {});
  const getAcceptedVersion = vi.fn(async (_o: string) => acceptedVersion);
  const store: ConsentStore = { recordConsent, getAcceptedVersion };
  return { service: createConsentService(store), recordConsent, getAcceptedVersion };
}

describe('consentService.acceptConsent', () => {
  it('records the current version for the org/user', async () => {
    const { service, recordConsent } = build(null);
    const result = await service.acceptConsent('org-1', 'user-1', CURRENT_CONSENT_VERSION);
    expect(result).toEqual({ ok: true });
    expect(recordConsent).toHaveBeenCalledWith('org-1', 'user-1', CURRENT_CONSENT_VERSION);
  });

  it('rejects a stale version and writes nothing', async () => {
    const { service, recordConsent } = build(null);
    const result = await service.acceptConsent('org-1', 'user-1', '0');
    expect(result).toEqual({ ok: false, reason: 'stale_version' });
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

describe('consentService.getStatus / hasCurrentConsent', () => {
  it('reports accepted when the stored version is current', async () => {
    const { service } = build(CURRENT_CONSENT_VERSION);
    expect(await service.getStatus('org-1')).toEqual({
      currentVersion: CURRENT_CONSENT_VERSION,
      acceptedVersion: CURRENT_CONSENT_VERSION,
      accepted: true,
    });
    expect(await service.hasCurrentConsent('org-1')).toBe(true);
  });

  it('reports not-accepted when there is no consent', async () => {
    const { service } = build(null);
    const status = await service.getStatus('org-1');
    expect(status.acceptedVersion).toBeNull();
    expect(status.accepted).toBe(false);
    expect(await service.hasCurrentConsent('org-1')).toBe(false);
  });

  it('reports not-accepted when the stored version is stale', async () => {
    const { service } = build('0');
    expect((await service.getStatus('org-1')).accepted).toBe(false);
    expect(await service.hasCurrentConsent('org-1')).toBe(false);
  });
});

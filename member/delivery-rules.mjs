// Pure multilingual entitlement and release rules for the membership sandbox.
// No Stripe calls, database writes, or email sends occur in this module.
export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'de', 'pt-PT']);
export const ACTIVE_STATUSES = new Set(['active', 'trialing']);
export function selectLanguage(raw) {
  const code = String(raw ?? '').trim().toLowerCase().replace('_', '-');
  if (code === 'de' || code === 'de-de') return 'de';
  if (code === 'pt' || code === 'pt-pt') return 'pt-PT';
  return 'en';
}
export function isEntitled({status, currentPeriodEnd}, now = new Date()) {
  if (!ACTIVE_STATUSES.has(status) || !currentPeriodEnd) return false;
  const end = new Date(currentPeriodEnd);
  return Number.isFinite(end.valueOf()) && end > now;
}
export function approvedEdition(release, requestedLanguage) {
  const language = selectLanguage(requestedLanguage);
  if (!release || release.status !== 'published') return null;
  const edition = release.editions?.[language];
  return edition && edition.approved === true && edition.storageKey ? edition : null;
}
export function outboxKey(releaseId, memberId, kind = 'release') {
  if (!releaseId || !memberId || !['welcome','release'].includes(kind)) throw new Error('Invalid delivery identity');
  return [releaseId,memberId,kind].join(':');
}

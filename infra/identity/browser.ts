import { createWebIdentity } from '../../apps/web/src/identity.js';
import { runIdentityProbe } from '../../packages/contracts/dist/identity-probe.js';
try {
  const result = { passed: true, checks: runIdentityProbe(createWebIdentity) };
  Object.assign(globalThis, { us023Report: result });
} catch {
  Object.assign(globalThis, { us023Report: { passed: false } });
}

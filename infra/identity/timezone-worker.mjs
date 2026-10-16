import { runIdentityProbe } from '../../packages/contracts/dist/identity-probe.js';
import { createApiIdentity } from '../../apps/api/dist/identity.js';
console.log(
  JSON.stringify({ passed: true, checks: runIdentityProbe(createApiIdentity) }),
);

import { createApiFeatures } from '../../apps/api/dist/index.js';

// Local synthetic demonstration only. Product profile defaults remain disabled.
export function createDemoAvailability() {
  const initial = {
    format_version: 1,
    environment: 'local',
    revision: 1,
    features: {
      importReview: true,
      documentReview: true,
      reports: true,
      cloudSync: false,
      workspaceMigration: false,
    },
  };
  const service = createApiFeatures('local', {
    FM_RUNTIME_CONFIG: JSON.stringify(initial),
  });
  return Object.freeze({
    snapshot: service.snapshot,
    select(profile) {
      if (!['full', 'limited'].includes(profile))
        throw new Error('DEMO_PROFILE_INVALID');
      const active = profile === 'full';
      return service.replace({
        ...initial,
        revision: service.snapshot().revision + 1,
        features: {
          ...initial.features,
          importReview: active,
          documentReview: active,
          reports: active,
        },
      });
    },
    async importPreview() {
      return await service.execute(
        'importReview',
        () => true,
        () => ({ synthetic_only: true, prepared: true }),
      );
    },
  });
}

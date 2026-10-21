import { planValidation, assertCatalogCurrent } from './planner.mjs';
import { runValidation } from './runner.mjs';

const [command = 'plan', ...args] = process.argv.slice(2);
try {
  const full = args.includes('--full');
  const forceScopes = args
    .filter((arg) => arg.startsWith('--suite='))
    .map((arg) => arg.slice(8));
  if (
    args.some((arg) => arg !== '--full' && !arg.startsWith('--suite=')) ||
    !['plan', 'check', 'run'].includes(command) ||
    (command !== 'run' && forceScopes.length)
  )
    throw Error(
      'USAGE: node infra/validation/cli.mjs plan|check|run [--full] [--suite=scope]',
    );
  if (command === 'run')
    console.log(
      JSON.stringify(await runValidation({ full, forceScopes }), null, 2),
    );
  else {
    const plan =
      command === 'check'
        ? await assertCatalogCurrent()
        : await planValidation({ full });
    console.log(
      JSON.stringify(
        {
          protocols: plan.suites.length,
          pending: plan.suites
            .filter((suite) => suite.selected)
            .map(({ scope, reason, changed }) => ({ scope, reason, changed })),
          reusable: plan.suites.filter((suite) => !suite.selected).length,
          unclassified: plan.unclassified,
        },
        null,
        2,
      ),
    );
    if (plan.unclassified.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

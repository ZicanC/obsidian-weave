import { logger } from '../utils/logger';
import { testRunner } from '../utils/test-runner';

/**
 * Legacy manual launcher for the in-app test runner.
 * The active automated test suite is `npm run test` via Vitest.
 */

export async function runAllTests(): Promise<boolean> {
  logger.debug('[legacy-test-launcher] Starting manually registered legacy tests.');

  try {
    const report = await testRunner.run();

    if (report.suites.length === 0) {
      logger.debug(
        '[legacy-test-launcher] No legacy suites are registered. Use `npm run test` for the Vitest suite.'
      );
    }

    return report.success;
  } catch (error) {
    logger.error('[legacy-test-launcher] Failed to run legacy tests.', error);
    return false;
  }
}

export async function runDevTests(): Promise<void> {
  const success = await runAllTests();

  logger.debug(
    success
      ? '[legacy-test-launcher] Legacy test launcher completed without failures.'
      : '[legacy-test-launcher] Legacy test launcher reported failures.'
  );
}

export default runAllTests;

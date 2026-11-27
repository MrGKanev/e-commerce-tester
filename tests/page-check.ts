import { test, expect } from './fixtures';
import type { TestStepInfo } from '@playwright/test';

/** Keep independent checks visible and continue after an assertion or inspector error. */
export async function pageCheck<T>(name: string, body: (step: TestStepInfo) => Promise<T>) {
  try {
    return await test.step(name, body);
  } catch (error) {
    expect
      .soft(() => {
        throw error;
      }, name)
      .not.toThrow();
    return undefined;
  }
}

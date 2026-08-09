'use server';

import { HookHarness, HookStage } from '@/lib/harness/hook-harness';

export async function runHookHarness(phase: HookStage, context: any) {
  return await HookHarness.run(phase, context);
}

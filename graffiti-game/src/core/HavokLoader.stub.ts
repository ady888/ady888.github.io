/**
 * Stand-in for HavokLoader in the single-file build.
 *
 * Keeping the whole Havok dependency out of that bundle saves ~2 MB of WASM
 * that could not be fetched from `file://` anyway. PhysicsWorld catches the
 * rejection and carries on with static props.
 */
export async function loadHavok(): Promise<never> {
  throw new Error("Havok is excluded from the standalone single-file build.");
}

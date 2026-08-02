/**
 * Isolates the Havok import so the standalone build can swap it out.
 *
 * Havok ships as an ES module with a companion WASM binary fetched at runtime.
 * That combination cannot work from a `file://` URL, so the single-file build
 * aliases this module to `HavokLoader.stub.ts` and the game runs without loose
 * physics props (see PhysicsWorld, which already treats that as a normal path).
 */
import HavokPhysics from "@babylonjs/havok";
import wasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

export async function loadHavok(): Promise<Awaited<ReturnType<typeof HavokPhysics>>> {
  return HavokPhysics({ locateFile: () => wasmUrl });
}

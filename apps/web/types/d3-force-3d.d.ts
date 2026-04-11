// Minimal declaration for d3-force-3d. The package is a drop-in
// superset of d3-force — same API surface plus a z coordinate and a
// numDimensions() method on the simulation. Upstream ships only ES
// modules without a .d.ts, so we re-export d3-force's types with the
// small extensions we actually use.

declare module "d3-force-3d" {
  import type {
    Simulation,
    SimulationNodeDatum as Base2D,
    SimulationLinkDatum as BaseLink2D,
    ForceLink,
    ForceManyBody,
    ForceCollide,
    ForceCenter,
  } from "d3-force"

  export interface SimulationNodeDatum extends Base2D {
    z?: number
    vz?: number
    fz?: number | null
  }

  export type SimulationLinkDatum<N extends SimulationNodeDatum> = BaseLink2D<N>

  interface Simulation3D<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends undefined | SimulationLinkDatum<NodeDatum>,
  > extends Simulation<NodeDatum, LinkDatum> {
    numDimensions(): number
    numDimensions(dimensions: number): this
  }

  export function forceSimulation<
    NodeDatum extends SimulationNodeDatum = SimulationNodeDatum,
    LinkDatum extends undefined | SimulationLinkDatum<NodeDatum> = undefined,
  >(nodes?: NodeDatum[]): Simulation3D<NodeDatum, LinkDatum>

  export function forceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum>,
  >(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>

  export function forceManyBody<
    NodeDatum extends SimulationNodeDatum,
  >(): ForceManyBody<NodeDatum>

  export function forceCollide<
    NodeDatum extends SimulationNodeDatum,
  >(radius?: number | ((d: NodeDatum, i: number, data: NodeDatum[]) => number)): ForceCollide<NodeDatum>

  export function forceCenter<
    NodeDatum extends SimulationNodeDatum,
  >(x?: number, y?: number, z?: number): ForceCenter<NodeDatum>
}

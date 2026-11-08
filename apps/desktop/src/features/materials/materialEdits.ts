import { BackSide, Color, DoubleSide, FrontSide, MeshStandardMaterial, Texture, type Material, type Mesh } from "three";
import type { EditorCommand, MaterialProperties } from "@movynta/editor-protocol";
import { copyTopology } from "../meshGeometry/meshTopology";
import { modifierStack } from "../meshGeometry/modifierStack";

/** One of the editor commands that change a material. */
export type MaterialEditCommand = Extract<
  EditorCommand,
  { type: "material.set_properties" | "material.add_slot" | "material.replace_slot" }
>;
/** Whether a command is one of the material edits. */
export function isMaterialEdit(command: EditorCommand): command is MaterialEditCommand {
  return (
    command.type === "material.set_properties" ||
    command.type === "material.add_slot" ||
    command.type === "material.replace_slot"
  );
}
/** The material slots of a mesh, as a list. */
export function materialSlots(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
/** Reads a page of a mesh's material slots for the assistant's material inspection. */
export function inspectMaterials(mesh: Mesh, offset: number, limit: number) {
  return materialSlots(mesh)
    .slice(offset, offset + limit)
    .map((material, i) => {
      const standard = material instanceof MeshStandardMaterial ? material : null;
      const color = "color" in material && material.color instanceof Color ? material.color : null;
      return {
        slot: offset + i,
        name: material.name.slice(0, 120),
        type: material.type.slice(0, 80),
        editable: standard !== null,
        color: color ? "#" + color.getHexString() : null,
        roughness: standard?.roughness ?? null,
        metalness: standard?.metalness ?? null,
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
        emissive: standard ? "#" + standard.emissive.getHexString() : null,
        emissiveIntensity: standard?.emissiveIntensity ?? null,
        side:
          material.side === DoubleSide
            ? ("double" as const)
            : material.side === BackSide
              ? ("back" as const)
              : ("front" as const),
        textures: Object.entries(material)
          .filter(([, value]) => value instanceof Texture)
          .map(([key]) => key)
          .slice(0, 32),
      };
    });
}

function setProperties(material: MeshStandardMaterial, properties: MaterialProperties): void {
  if (properties.name !== undefined) material.name = properties.name;
  if (properties.color !== undefined) material.color.set(properties.color);
  if (properties.roughness !== undefined) material.roughness = properties.roughness;
  if (properties.metalness !== undefined) material.metalness = properties.metalness;
  if (properties.emissive !== undefined) material.emissive.set(properties.emissive);
  if (properties.emissiveIntensity !== undefined) material.emissiveIntensity = properties.emissiveIntensity;
  if (properties.opacity !== undefined) {
    material.opacity = properties.opacity;
    material.transparent = properties.opacity < 1;
  }
  if (properties.depthWrite !== undefined) material.depthWrite = properties.depthWrite;
  if (properties.side !== undefined)
    material.side = properties.side === "double" ? DoubleSide : properties.side === "back" ? BackSide : FrontSide;
  material.needsUpdate = true;
}

/** Must run on an isolated scene candidate: preserves source texture references and physical parameters. */
export function applyMaterialEdit(mesh: Mesh, command: MaterialEditCommand): void {
  const slots = materialSlots(mesh);
  if (command.type === "material.add_slot") {
    if (slots.length !== command.slot || slots.length >= 256)
      throw new Error("Append at the current materialSlotCount, up to 256 slots; inspect materials again");
    if (!Array.isArray(mesh.material) || slots.length === 0) {
      // Single-material meshes ignore their face group indices. Preserve that appearance before enabling slots.
      const stack = modifierStack(mesh);
      for (const geometry of new Set([mesh.geometry, ...(stack ? [stack.base, stack.geometry] : [])])) {
        for (const group of geometry.groups) group.materialIndex = 0;
        copyTopology(geometry, geometry, 0);
      }
    }
    const next = new MeshStandardMaterial();
    try {
      setProperties(next, command.properties);
    } catch (error) {
      next.dispose();
      throw error;
    }
    mesh.material = [...slots, next];
    return;
  }
  const current = slots[command.slot];
  if (!current) throw new Error("Material slot does not exist; inspect materials again");
  if (command.type === "material.set_properties") {
    if (!(current instanceof MeshStandardMaterial))
      throw new Error(
        "This imported material is not a Standard/Physical material; use explicit replace_slot to replace its shader",
      );
    setProperties(current, command.properties);
  } else {
    const next = new MeshStandardMaterial();
    try {
      setProperties(next, command.properties);
    } catch (error) {
      next.dispose();
      throw error;
    }
    if (Array.isArray(mesh.material)) mesh.material[command.slot] = next;
    else mesh.material = next;
    current.dispose();
  }
}

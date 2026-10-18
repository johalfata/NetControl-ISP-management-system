import type { InfraNode } from "@prisma/client";
import type { OltAdapter } from "./types";
import { genericOltAdapter } from "./generic";
import { hsgqOltAdapter } from "./hsgq";

export * from "./types";
export { genericOltAdapter } from "./generic";
export { hsgqOltAdapter } from "./hsgq";

export function getOltAdapter(node: InfraNode): OltAdapter {
  const vendor = (node.vendor || node.adapterKey || "").toLowerCase();
  if (vendor.includes("hsgq")) {
    return hsgqOltAdapter(node);
  }
  return genericOltAdapter(node);
}

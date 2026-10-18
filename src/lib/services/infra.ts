import { z } from "zod";
import { prisma, type Tx } from "../db";
import { assertPermission, type Actor } from "../permissions";
import { recordAudit } from "../audit";
import { sealSecret } from "../crypto";
import { InfraNodeType, InfraLinkType, DeviceStatus, AuthMethod, type InfraNode, type InfraLink, type Prisma } from "@prisma/client";

export const createInfraNodeSchema = z.object({
  code: z.string().min(1, "Kode node wajib diisi"),
  name: z.string().min(1, "Nama node wajib diisi"),
  type: z.nativeEnum(InfraNodeType),
  vendor: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  ipAddress: z.string().optional(),
  apiPort: z.number().int().optional(),
  adapterKey: z.string().optional(),
  apiAuthMethod: z.nativeEnum(AuthMethod).default("PLAIN"),
  apiPassword: z.string().optional(),
  locationName: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  parentId: z.string().optional(),
  capacityPorts: z.number().int().optional(),
  usedPorts: z.number().int().optional(),
  status: z.nativeEnum(DeviceStatus).default("UNKNOWN"),
  capabilities: z.any().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

export type CreateInfraNodeInput = z.infer<typeof createInfraNodeSchema>;

export const updateInfraNodeSchema = createInfraNodeSchema.partial();
export type UpdateInfraNodeInput = z.infer<typeof updateInfraNodeSchema>;

export const createInfraLinkSchema = z.object({
  fromNodeId: z.string().min(1, "Node asal wajib diisi"),
  toNodeId: z.string().min(1, "Node tujuan wajib diisi"),
  linkType: z.nativeEnum(InfraLinkType).default("OTHER"),
  label: z.string().optional(),
  capacity: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateInfraLinkInput = z.infer<typeof createInfraLinkSchema>;

export type InfraNodeView = InfraNode & {
  childrenCount?: number;
  parentName?: string | null;
};

export type TopologyView = {
  nodes: InfraNode[];
  links: InfraLink[];
};

export async function listInfraNodes(
  filter: { type?: InfraNodeType; status?: DeviceStatus; parentId?: string; search?: string } = {},
  client: Tx | typeof prisma = prisma,
): Promise<InfraNodeView[]> {
  const where: Prisma.InfraNodeWhereInput = {};
  if (filter.type) where.type = filter.type;
  if (filter.status) where.status = filter.status;
  if (filter.parentId) where.parentId = filter.parentId;
  if (filter.search) {
    where.OR = [
      { name: { contains: filter.search, mode: "insensitive" } },
      { code: { contains: filter.search, mode: "insensitive" } },
      { ipAddress: { contains: filter.search, mode: "insensitive" } },
    ];
  }

  const nodes = await client.infraNode.findMany({
    where,
    include: {
      parent: { select: { name: true } },
      _count: { select: { children: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return nodes.map((n) => ({
    ...n,
    childrenCount: n._count.children,
    parentName: n.parent?.name ?? null,
  }));
}

export async function getInfraNode(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<InfraNode & { children: InfraNode[]; parent: InfraNode | null; linksFrom: InfraLink[]; linksTo: InfraLink[] }> {
  const node = await client.infraNode.findUnique({
    where: { id },
    include: {
      children: true,
      parent: true,
      linksFrom: { include: { toNode: true } },
      linksTo: { include: { fromNode: true } },
    },
  });
  if (!node) {
    throw new Error(`Node infrastruktur dengan ID ${id} tidak ditemukan`);
  }
  return node;
}

export async function createInfraNode(
  actor: Actor,
  input: CreateInfraNodeInput,
  client: Tx | typeof prisma = prisma,
): Promise<InfraNode> {
  assertPermission(actor, "network.manage");
  const parsed = createInfraNodeSchema.parse(input);

  let sealed = undefined;
  if (parsed.apiPassword) {
    const s = sealSecret(parsed.apiPassword);
    sealed = {
      apiSecretCiphertext: s.ciphertext,
      apiSecretIv: s.iv,
      apiSecretAuthTag: s.authTag,
      apiSecretFingerprint: s.ciphertext.slice(0, 16),
    };
  }

  const { apiPassword: _, ...rest } = parsed;
  const node = await client.infraNode.create({
    data: {
      ...rest,
      ...sealed,
    },
  });

  await recordAudit(
    actor,
    {
      action: "infra.node.create",
      entityType: "InfraNode",
      entityId: node.id,
      metadata: { code: node.code, name: node.name, type: node.type },
    },
    client,
  );

  return node;
}

export async function updateInfraNode(
  actor: Actor,
  id: string,
  input: UpdateInfraNodeInput,
  client: Tx | typeof prisma = prisma,
): Promise<InfraNode> {
  assertPermission(actor, "network.manage");
  const parsed = updateInfraNodeSchema.parse(input);

  let sealed = undefined;
  if (parsed.apiPassword !== undefined) {
    if (parsed.apiPassword) {
      const s = sealSecret(parsed.apiPassword);
      sealed = {
        apiSecretCiphertext: s.ciphertext,
        apiSecretIv: s.iv,
        apiSecretAuthTag: s.authTag,
        apiSecretFingerprint: s.ciphertext.slice(0, 16),
      };
    } else {
      sealed = {
        apiSecretCiphertext: null,
        apiSecretIv: null,
        apiSecretAuthTag: null,
        apiSecretFingerprint: null,
      };
    }
  }

  const { apiPassword: _, ...rest } = parsed;
  const node = await client.infraNode.update({
    where: { id },
    data: {
      ...rest,
      ...sealed,
    },
  });

  await recordAudit(
    actor,
    {
      action: "infra.node.update",
      entityType: "InfraNode",
      entityId: node.id,
      metadata: { code: node.code, name: node.name },
    },
    client,
  );

  return node;
}

export async function deleteInfraNode(
  actor: Actor,
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<{ id: string; code: string }> {
  assertPermission(actor, "network.manage");
  const node = await client.infraNode.findUnique({
    where: { id },
    select: { id: true, code: true, name: true },
  });
  if (!node) {
    throw new Error(`Node infrastruktur dengan ID ${id} tidak ditemukan`);
  }

  await client.infraNode.delete({ where: { id } });

  await recordAudit(
    actor,
    {
      action: "infra.node.delete",
      entityType: "InfraNode",
      entityId: id,
      metadata: { code: node.code, name: node.name },
    },
    client,
  );

  return { id: node.id, code: node.code };
}

export async function createInfraLink(
  actor: Actor,
  input: CreateInfraLinkInput,
  client: Tx | typeof prisma = prisma,
): Promise<InfraLink> {
  assertPermission(actor, "network.manage");
  const parsed = createInfraLinkSchema.parse(input);

  const link = await client.infraLink.create({
    data: parsed,
  });

  await recordAudit(
    actor,
    {
      action: "infra.link.create",
      entityType: "InfraLink",
      entityId: link.id,
      metadata: { fromNodeId: link.fromNodeId, toNodeId: link.toNodeId, linkType: link.linkType },
    },
    client,
  );

  return link;
}

export async function deleteInfraLink(
  actor: Actor,
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<{ id: string }> {
  assertPermission(actor, "network.manage");
  const link = await client.infraLink.findUnique({ where: { id } });
  if (!link) {
    throw new Error(`Link infrastruktur dengan ID ${id} tidak ditemukan`);
  }

  await client.infraLink.delete({ where: { id } });

  await recordAudit(
    actor,
    {
      action: "infra.link.delete",
      entityType: "InfraLink",
      entityId: id,
      metadata: { fromNodeId: link.fromNodeId, toNodeId: link.toNodeId },
    },
    client,
  );

  return { id };
}

export async function getTopology(
  client: Tx | typeof prisma = prisma,
): Promise<TopologyView> {
  const nodes = await client.infraNode.findMany({
    where: { isActive: true },
  });
  const links = await client.infraLink.findMany();
  return { nodes, links };
}

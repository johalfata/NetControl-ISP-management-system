import type { InfraNode } from "@prisma/client";
import type { OltAdapter, OltSystemInfo, OnuInfo } from "./types";
import { openSecret } from "../../crypto";

export function genericOltAdapter(node: InfraNode): OltAdapter {
  const _host = node.ipAddress || "localhost";
  const _password = node.apiSecretCiphertext && node.apiSecretIv && node.apiSecretAuthTag
    ? openSecret({
        ciphertext: node.apiSecretCiphertext,
        iv: node.apiSecretIv,
        authTag: node.apiSecretAuthTag,
      })
    : undefined;

  return {
    async getSystemInfo(): Promise<OltSystemInfo> {
      return {
        identity: node.name || node.code,
        vendor: node.vendor || "Generic",
        model: node.model || "OLT-Generic",
        version: "1.0.0",
        uptimeSec: 86400,
        cpuLoadPct: 15,
        freeMemoryPct: 75,
        temperatureC: 42.5,
      };
    },
    async getOnuList(): Promise<OnuInfo[]> {
      return [];
    },
    async getOnuStatus(onuId: string): Promise<OnuInfo> {
      return {
        onuId,
        name: `ONU-${onuId}`,
        serialNumber: "SN123456",
        rxPowerDbm: -20.5,
        txPowerDbm: 2.0,
        distanceMeters: 500,
        status: "UP",
      };
    },
    async rebootOnu(onuId: string): Promise<void> {
      // Mock reboot action for generic OLT
      if (!onuId) throw new Error("ONU ID required");
    },
  };
}

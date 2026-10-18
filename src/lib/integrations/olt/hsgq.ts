import type { InfraNode } from "@prisma/client";
import type { OltAdapter, OltSystemInfo, OnuInfo } from "./types";
import { openSecret } from "../../crypto";

export function hsgqOltAdapter(node: InfraNode): OltAdapter {
  const _host = node.ipAddress || "localhost";
  const _secret = node.apiSecretCiphertext && node.apiSecretIv && node.apiSecretAuthTag
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
        vendor: "HSGQ",
        model: node.model || "HSGQ-OLT",
        version: "2.4.1",
        uptimeSec: 172800,
        cpuLoadPct: 22,
        freeMemoryPct: 65,
        temperatureC: 39.0,
      };
    },
    async getOnuList(): Promise<OnuInfo[]> {
      return [
        {
          onuId: "onu-1",
          name: "Customer ONU 1",
          serialNumber: "HSGQ12345678",
          rxPowerDbm: -19.2,
          txPowerDbm: 1.8,
          distanceMeters: 350,
          status: "UP",
          profile: "DEFAULT",
        },
      ];
    },
    async getOnuStatus(onuId: string): Promise<OnuInfo> {
      return {
        onuId,
        name: `ONU-${onuId}`,
        serialNumber: "HSGQ12345678",
        rxPowerDbm: -19.2,
        txPowerDbm: 1.8,
        distanceMeters: 350,
        status: "UP",
        profile: "DEFAULT",
      };
    },
    async rebootOnu(onuId: string): Promise<void> {
      if (!onuId) throw new Error("ONU ID required for HSGQ reboot");
    },
  };
}

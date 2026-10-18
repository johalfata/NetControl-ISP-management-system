
export type OltSystemInfo = {
  identity: string;
  vendor: string;
  model: string;
  version?: string;
  uptimeSec?: number;
  cpuLoadPct?: number;
  freeMemoryPct?: number;
  temperatureC?: number;
};

export type OnuInfo = {
  onuId: string;
  name: string;
  serialNumber: string;
  rxPowerDbm?: number;
  txPowerDbm?: number;
  distanceMeters?: number;
  status: "UP" | "DOWN" | "UNKNOWN";
  profile?: string;
};

export interface OltAdapter {
  getSystemInfo(): Promise<OltSystemInfo>;
  getOnuList(): Promise<OnuInfo[]>;
  getOnuStatus(onuId: string): Promise<OnuInfo>;
  rebootOnu(onuId: string): Promise<void>;
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  openIncident,
  acknowledgeIncident,
  resolveIncident,
  listIncidents,
  evaluateAlerts,
} from "../../src/lib/services/incidents";
import {
  createAlertRule,
  matchesComparator,
} from "../../src/lib/services/alerts";
import { TEST_ACTOR, SYSTEM_ACTOR, withRollback, cleanupNetworkData, ensureTestUser } from "./helpers";


beforeAll(async () => {
  await cleanupNetworkData();
  await ensureTestUser();
});


afterAll(async () => {
  await cleanupNetworkData();
});

describe("matchesComparator", () => {
  it("mengevaluasi semua operator dengan benar", () => {
    expect(matchesComparator(">", 10, 5)).toBe(true);
    expect(matchesComparator(">", 5, 5)).toBe(false);
    expect(matchesComparator(">=", 5, 5)).toBe(true);
    expect(matchesComparator("<", 3, 5)).toBe(true);
    expect(matchesComparator("<", 5, 5)).toBe(false);
    expect(matchesComparator("<=", 5, 5)).toBe(true);
    expect(matchesComparator("==", 5, 5)).toBe(true);
    expect(matchesComparator("==", 5, 5.1)).toBe(false);
  });
});

describe("openIncident — dedupe via dedupeKey", () => {
  it("membuat insiden pertama, lalu mengembalikan insiden yang sama untuk key sama", async () => {
    await withRollback(async (tx) => {
      const first = await openIncident(
        TEST_ACTOR,
        {
          type: "DEVICE_DOWN",
          severity: "CRITICAL",
          subjectType: "Router",
          subjectId: "router-a",
          title: "Router A tidak merespons",
          dedupeKey: "dedupe:router-a:down",
        },
        tx,
      );
      expect(first.created).toBe(true);
      expect(first.incident.status).toBe("OPEN");

      const second = await openIncident(
        TEST_ACTOR,
        {
          type: "DEVICE_DOWN",
          severity: "CRITICAL",
          subjectType: "Router",
          subjectId: "router-a",
          title: "Router A tidak merespons (duplikat)",
          dedupeKey: "dedupe:router-a:down",
        },
        tx,
      );
      expect(second.created).toBe(false);
      expect(second.incident.id).toBe(first.incident.id);
      expect(second.incident.title).toBe("Router A tidak merespons");
    });
  });
});

describe("acknowledgeIncident / resolveIncident", () => {
  it("mengubah status OPEN → ACKNOWLEDGED → RESOLVED dengan waktu & aktor", async () => {
    await withRollback(async (tx) => {
      const { incident } = await openIncident(
        TEST_ACTOR,
        {
          type: "HIGH_LATENCY",
          severity: "WARNING",
          subjectType: "WanLink",
          subjectId: "wan-1",
          title: "Latensi Starlink tinggi",
        },
        tx,
      );

      const acked = await acknowledgeIncident(TEST_ACTOR, incident.id, tx);
      expect(acked.status).toBe("ACKNOWLEDGED");
      expect(acked.acknowledgedAt).not.toBeNull();
      expect(acked.acknowledgedById).toBe(TEST_ACTOR.userId);

      const resolved = await resolveIncident(
        TEST_ACTOR,
        incident.id,
        { resolution: "Link dipindah ke backup" },
        tx,
      );
      expect(resolved.status).toBe("RESOLVED");
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.description).toContain("Link dipindah ke backup");
    });
  });

  it("acknowledge ditolak untuk insiden yang sudah RESOLVED", async () => {
    await withRollback(async (tx) => {
      const { incident } = await openIncident(
        TEST_ACTOR,
        {
          type: "OTHER",
          severity: "INFO",
          subjectType: "Router",
          title: "Insiden tes",
        },
        tx,
      );
      await resolveIncident(TEST_ACTOR, incident.id, { resolution: "selesai" }, tx);
      await expect(acknowledgeIncident(TEST_ACTOR, incident.id, tx)).rejects.toThrow();
    });
  });

  it("acknowledge/resolve idempoten bila dipanggil dua kali", async () => {
    await withRollback(async (tx) => {
      const { incident } = await openIncident(
        TEST_ACTOR,
        { type: "OTHER", severity: "INFO", subjectType: "Router", title: "Idempotensi" },
        tx,
      );
      const first = await acknowledgeIncident(TEST_ACTOR, incident.id, tx);
      const second = await acknowledgeIncident(TEST_ACTOR, incident.id, tx);
      expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());

      const resolved1 = await resolveIncident(TEST_ACTOR, incident.id, { resolution: "ok" }, tx);
      const resolved2 = await resolveIncident(TEST_ACTOR, incident.id, { resolution: "ok" }, tx);
      expect(resolved2.resolvedAt?.getTime()).toBe(resolved1.resolvedAt?.getTime());

    });
  });
});

describe("listIncidents", () => {
  it("memfilter berdasarkan status, tipe, dan rentang waktu", async () => {
    await withRollback(async (tx) => {
      await openIncident(
        TEST_ACTOR,
        { type: "DEVICE_DOWN", severity: "CRITICAL", subjectType: "Router", title: "A" },
        tx,
      );
      await openIncident(
        TEST_ACTOR,
        { type: "HIGH_LATENCY", severity: "WARNING", subjectType: "WanLink", title: "B" },
        tx,
      );

      const all = await listIncidents({}, tx);
      expect(all.items.length).toBe(2);
      expect(all.total).toBe(2);

      const onlyDown = await listIncidents({ type: "DEVICE_DOWN" }, tx);
      expect(onlyDown.items.every((i) => i.type === "DEVICE_DOWN")).toBe(true);
      expect(onlyDown.items.length).toBe(1);

      const paginated = await listIncidents({ page: 1, pageSize: 1 }, tx);
      expect(paginated.items.length).toBe(1);
      expect(paginated.page).toBe(1);
    });
  });
});

describe("evaluateAlerts", () => {
  it("membuat insiden saat ambang terlampaui", async () => {
    await withRollback(async (tx) => {
      const rule = await createAlertRule(
        TEST_ACTOR,
        {
          code: "ALERT-LAT-1",
          name: "Latensi WAN tinggi",
          type: "HIGH_LATENCY",
          targetType: "WanLink",
          targetId: "wan-eval-1",
          comparator: ">",
          threshold: 100,
          severity: "WARNING",
          cooldownMin: 30,
          enabled: true,
        },
        tx,
      );

      // Sisipkan metrik langsung: latensi 250ms (> 100).
      const wanLink = await tx.wanLink.create({
        data: {
          id: "wan-eval-1",
          code: "WAN-EVAL-1",
          name: "Link evaluasi",
          type: "STARLINK",
          routerId: null,
          interfaceName: "ether-eval-1",
          capacityDownKbps: 100000,
          monitorEnabled: true,
          isActive: true,
        },
      });
      await tx.router.create({
        data: { id: "router-eval-fixed", code: "RTR-EVAL-1", name: "Router evaluasi", host: "10.0.0.1", username: "admin" },
      });
      await tx.interfaceMetric.create({
        data: {
          routerId: "router-eval-fixed",
          wanLinkId: wanLink.id,
          interfaceName: "ether-eval-1",
          capturedAt: new Date(),
          latencyMs: 250,
          rxBytes: 0n,
          txBytes: 0n,
        },
      });



      const result = await evaluateAlerts(SYSTEM_ACTOR, { asOf: new Date() }, tx);
      const evalForRule = result.evaluations.filter((e) => e.ruleId === rule.id);
      expect(evalForRule.length).toBeGreaterThan(0);
      expect(result.created.length).toBeGreaterThan(0);
      const created = result.created.find((c) => c.type === "HIGH_LATENCY");
      expect(created).toBeDefined();
      expect(created?.status).toBe("OPEN");
      expect(created?.severity).toBe("WARNING");
      expect(created?.dedupeKey).toBe(`alert:${rule.code}:WanLink:${wanLink.id}`);
    });
  });

  it("tidak membuat duplikat dalam masa cooldownMin", async () => {
    await withRollback(async (tx) => {
      const rule = await createAlertRule(
        TEST_ACTOR,
        {
          code: "ALERT-DOWN-1",
          name: "Router tidak aktif",
          type: "DEVICE_DOWN",
          targetType: "Router",
          targetId: "router-eval-fixed-2",
          comparator: "==",
          threshold: 0,
          severity: "CRITICAL",
          cooldownMin: 60,
          enabled: true,
        },
        tx,
      );
      await tx.router.create({
        data: {
          id: "router-eval-fixed-2",
          code: "RTR-EVAL-2",
          name: "Router evaluasi 2",
          host: "10.0.0.2",
          username: "admin",
          lastStatus: "DOWN",
        },
      });

      const first = await evaluateAlerts(SYSTEM_ACTOR, { asOf: new Date() }, tx);
      const triggeredFirst = first.evaluations.find((e) => e.ruleId === rule.id && e.triggered);
      expect(triggeredFirst?.incidentId).not.toBeNull();
      expect(first.created.length).toBeGreaterThan(0);

      // Evaluasi kedua, segera setelahnya — harus tertahan cooldown.
      const second = await evaluateAlerts(SYSTEM_ACTOR, { asOf: new Date() }, tx);
      const triggeredSecond = second.evaluations.find((e) => e.ruleId === rule.id && e.triggered);
      expect(second.created.length).toBe(0);
      expect(triggeredSecond?.skippedReason).toContain("jeda");
      expect(triggeredSecond?.incidentId).toBe(triggeredFirst?.incidentId);
    });
  });

  it("memicu lagi setelah masa cooldown terlewati", async () => {
    await withRollback(async (tx) => {
      const rule = await createAlertRule(
        TEST_ACTOR,
        {
          code: "ALERT-DOWN-2",
          name: "Router tidak aktif (cooldown pendek)",
          type: "DEVICE_DOWN",
          targetType: "Router",
          targetId: "router-eval-fixed-3",
          comparator: "==",
          threshold: 0,
          severity: "CRITICAL",
          cooldownMin: 1,
          enabled: true,
        },
        tx,
      );
      await tx.router.create({
        data: {
          id: "router-eval-fixed-3",
          code: "RTR-EVAL-3",
          name: "Router evaluasi 3",
          host: "10.0.0.3",
          username: "admin",
          lastStatus: "DOWN",
        },
      });

      const first = await evaluateAlerts(SYSTEM_ACTOR, {}, tx);
      expect(first.created.length).toBeGreaterThan(0);

      // Insiden lama di-RESOLVE dan didorong ke luar masa cooldown 1 menit.
      await tx.incident.updateMany({
        where: { dedupeKey: { startsWith: `alert:${rule.code}:` } },
        data: { status: "RESOLVED", dedupeKey: null, startedAt: new Date(Date.now() - 120_000), resolvedAt: new Date() },
      });


      const second = await evaluateAlerts(SYSTEM_ACTOR, {}, tx);
      expect(second.created.length).toBeGreaterThan(0);
    });
  });

  it("tidak memicu saat metrik di bawah ambang", async () => {
    await withRollback(async (tx) => {
      const rule = await createAlertRule(
        TEST_ACTOR,
        {
          code: "ALERT-UTIL-1",
          name: "Utilisasi rendah (tidak akan terpicu)",
          type: "OTHER",
          targetType: "Router",
          targetId: "router-eval-ok",
          comparator: ">",
          threshold: 1000,
          severity: "INFO",
          cooldownMin: 5,
        },
        tx,
      );
      await tx.router.create({
        data: {
          id: "router-eval-ok",
          code: "RTR-EVAL-OK",
          name: "Router sehat",
          host: "10.0.0.4",
          username: "admin",
          lastStatus: "UP",
        },
      });

      const result = await evaluateAlerts(SYSTEM_ACTOR, {}, tx);
      const evalForRule = result.evaluations.find((e) => e.ruleId === rule.id);
      expect(evalForRule?.triggered).toBe(false);
      expect(result.created.find((c) => c.id !== undefined && c.dedupeKey?.includes(rule.code))).toBeUndefined();
    });
  });
});

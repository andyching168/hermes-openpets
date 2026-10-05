import { host, PALETTE_AREA } from "@hermes/plugin-sdk";
import { ActivityTracker } from "./activity-model.ts";
import { createHermesAdapter, detectCapabilities, tierOf } from "./hermes-adapter.ts";
import { createOpenPetsAdapter } from "./openpets-adapter.ts";
import { StatePolicy } from "./state-policy.ts";

const ID = "hermes-openpets";

interface PluginSettings {
  openPetsUrl: string;
  enabled: boolean;
  showToolActivity: boolean;
  showCompletionAnimation: boolean;
  transientDurationMs: number;
  debugLogging: boolean;
}

const DEFAULTS: PluginSettings = {
  openPetsUrl: "http://127.0.0.1:3001",
  enabled: true,
  showToolActivity: true,
  showCompletionAnimation: true,
  transientDurationMs: 1600,
  debugLogging: false,
};

async function loadSettings(storage: any): Promise<PluginSettings> {
  try {
    const stored = await Promise.resolve(storage?.get?.("settings"));
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return { ...DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export default {
  id: ID,
  name: "OpenPets Bridge",
  register(ctx: any) {
    // Fail open: nothing in here may throw into Hermes.
    try {
      let settings: PluginSettings = { ...DEFAULTS };
      const log = (m: string) => {
        if (settings.debugLogging) console.debug(`[${ID}] ${m}`);
      };

      const caps = detectCapabilities(host);
      const tier = tierOf(caps);
      if (tier === "D") {
        console.warn(`[${ID}] required SDK capability (host.state.busy) missing; output disabled`);
        return;
      }

      const tracker = new ActivityTracker();
      const pets = createOpenPetsAdapter({ getUrl: () => settings.openPetsUrl, log });
      const policy = new StatePolicy({
        timers: {
          now: () => Date.now(),
          setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
        },
        get transientMs() {
          return settings.transientDurationMs;
        },
        showCompletionAnimation: () => settings.showCompletionAnimation,
        emit: (state, detail) => {
          if (!settings.enabled) return;
          log(`state -> ${state}`);
          void pets.setState(state, { text: settings.showToolActivity ? detail : undefined });
        },
      } as ConstructorParameters<typeof StatePolicy>[0]);

      const adapter = createHermesAdapter(host, ctx, log);
      adapter.start((ev) => {
        tracker.apply(ev);
        const snap = tracker.snapshot();
        tracker.clearPulses();
        // Tier C has no session/event context: only busy -> run, idle.
        policy.update(tier === "C" ? { ...snap, toolRunning: false, reasoning: false } : snap);
      });

      ctx.onDispose?.(() => {
        adapter.stop();
        policy.dispose();
        void pets.reset();
      });

      void loadSettings(ctx.storage).then((s) => {
        settings = s;
        log(`SDK capabilities: ${JSON.stringify(caps)} tier=${tier} mode=${caps.nativePetState ? "native" : "compatibility"}`);
        void pets.probe();
      });

      ctx.register?.({
        id: "status",
        area: PALETTE_AREA,
        data: {
          id: `${ID}.status`,
          label: "OpenPets: show bridge status",
          keywords: ["openpets", "pet", "bridge"],
          run: async () => {
            const reachable = await pets.probe();
            host.notify({
              kind: reachable ? "info" : "warning",
              message: `OpenPets bridge — tier ${tier}, ${caps.nativePetState ? "native" : "compatibility"} mode, ${settings.openPetsUrl} ${reachable ? "reachable" : "unreachable"}, pet state: ${policy.lastEmitted() ?? "none"}`,
            });
          },
        },
      });
    } catch (err) {
      console.warn(`[${ID}] failed to start:`, err instanceof Error ? err.message : err);
    }
  },
};

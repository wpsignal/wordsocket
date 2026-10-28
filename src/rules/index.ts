/*
 * `WPS.rules`: the registration API and the engine, seeded from `wpSignalConfig.rules` and replaced
 * by a newer, valid `rules.updated` frame. The live engine runs on front-end pages only; a firing
 * reaches `onFire` and, when PHP printed `firedUrl`, a `POST`. A pattern's markup is cached in
 * `sessionStorage` under the rules version, which PHP bumps when a named pattern is edited.
 */

import type { Attention } from "../attention/attention";
import { pageJourney } from "../presence/page-journey";
import type { Recovery } from "../recovery/recovery";
import { isCrawler, onChannel, visitorId } from "../utils/identity";
import { createEngine } from "./engine";
import {
  createRegistry,
  type ActionRun,
  type ConditionTest,
  type ContextRead,
  type Firing,
  type HistoryJourney,
  type HistoryProvider,
  type RuleContext,
} from "./registry";
import { validateRules } from "./schema";
import { restUrl } from "../utils/rest-url";
import { stored } from "../utils/storage";
import type { Rule } from "./types";
import {
  actions as builtinActions,
  conditions as builtinConditions,
} from "./vocabulary";

/** The client the rules module needs: events and the connection, so a test can stand one in. */
export interface RulesClient {
  on(
    event: string,
    handler: (data: Record<string, unknown>, channel: string) => void,
  ): () => void;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
}

export interface RulesApi {
  condition(key: string, test: ConditionTest): void;
  /**
   * Add a live value to the context under `key`; returns the function to call when it changes.
   */
  context(key: string, read: ContextRead): () => void;
  action(key: string, run: ActionRun): void;
  history(provider: HistoryProvider): void;
  onFire(handler: (firing: Firing, ctx: RuleContext) => void): () => void;
  replay(
    rule: Rule,
    journeys: HistoryJourney[],
  ): {
    count: number;
    fired: Array<{ index: number; step: number }>;
    unanswerable: string[];
  };
  readonly current: { version: number; rules: Rule[] };
  /** The history provider an extension registered, for the replay panel; null without one. */
  readonly historyProvider: HistoryProvider | null;
}

/** The rendered pattern `id` as fetched under rules `version`; null until fetched, "" when the route had nothing. */
const patternCache = (id: number, version: number) =>
  stored<string | null>(
    "session",
    `wordsocket-prompt-${id}:${version}`,
    () => null,
    (value): value is string => typeof value === "string",
  );

/**
 * `WPS.rules`: the registration API over the engine.
 *
 * @since 0.31.0 Runs no engine for a crawler.
 */
export function createRulesApi(
  client: RulesClient,
  config: WpSignalConfig,
  attention: Attention,
  recovery: Recovery,
): RulesApi {
  const registry = createRegistry();
  const seed = config.rules;
  /* Front-end pages only, never for a crawler. */
  const onFront = (config.presence?.kind ?? "admin") !== "admin";
  const page = onFront && !isCrawler() ? pageJourney() : null;

  const loadPattern = async (id: number): Promise<Node | null> => {
    if (!seed?.promptUrl) return null;
    const cache = patternCache(id, engine.version);
    let html = cache.read();
    if (html === null) {
      try {
        const res = await fetch(
          restUrl(seed.promptUrl, `/${id}`, { v: String(engine.version) }),
          { credentials: "same-origin" },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { html?: string };
        html = typeof body.html === "string" ? body.html : "";
        cache.write(html);
      } catch {
        return null;
      }
    }
    if (html === "") return null;
    const template = document.createElement("template");
    template.innerHTML = html;
    const wrap = document.createElement("div");
    wrap.className = "wordsocket-prompt__pattern";
    wrap.appendChild(template.content);
    return wrap;
  };

  const report = (firing: Firing, ctx: RuleContext) => {
    /* `onFire` receives firings only. */
    if (!firing.kind || firing.kind === "fired")
      registry.fireHandlers.forEach((fn) => fn(firing, ctx));
    if (!seed?.firedUrl || !page) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.nonce) headers["X-WP-Nonce"] = config.nonce;
    void fetch(seed.firedUrl, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers,
      body: JSON.stringify({
        v: visitorId(),
        n: page.journey.id(),
        rule: firing.rule,
        action: firing.action,
        step: firing.step,
        ms: firing.ms ?? 0,
        kind: firing.kind ?? "fired",
      }),
    }).catch(() => undefined);
  };

  const engine = createEngine({
    registry,
    recovery,
    attention,
    page,
    siteName: config.siteName ?? "",
    taxonomies: seed?.taxonomies ?? [],
    timezone: seed?.timezone ?? "",
    report,
  });
  Object.entries(builtinConditions).forEach(([key, test]) =>
    registry.conditions.set(key, test),
  );
  Object.entries(builtinActions({ attention, loadPattern })).forEach(
    ([key, run]) => registry.actions.set(key, run),
  );

  if (seed && validateRules(seed.rules)) {
    engine.setRules(seed.rules, Number(seed.version) || 0);
  }

  /* A frame or a fetched set applies only when newer and well formed, whichever arrives first. */
  const apply = (data: Record<string, unknown>) => {
    const version = Number(data.version);
    if (!Number.isFinite(version) || version <= engine.version) return;
    if (!validateRules(data.rules)) return;
    engine.setRules(data.rules, version);
  };
  client.on("rules.updated", (data, channel) => {
    if (onChannel(channel, "events")) apply(data);
  });
  /*
   * A tab that was down during a save missed its frame, so every reconnect (not the first connect:
   * the seed is as fresh as the page) asks the live route once and applies by the same version check.
   */
  let connects = 0;
  client.onConnectionChange((connected) => {
    if (!connected || ++connects < 2 || !seed?.liveUrl) return;
    void fetch(restUrl(seed.liveUrl, "", { v: String(engine.version) }), {
      credentials: "same-origin",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && typeof data === "object") apply(data);
      })
      .catch(() => undefined);
  });

  return {
    condition(key, test) {
      registry.conditions.set(key, test);
      engine.evaluate("registered");
    },
    context(key, read) {
      registry.contexts.set(key, read);
      engine.evaluate("registered");
      return () => registry.contextHandlers.forEach((fn) => fn());
    },
    action(key, run) {
      registry.actions.set(key, run);
    },
    history(provider) {
      registry.history = provider;
    },
    onFire(handler) {
      registry.fireHandlers.add(handler);
      return () => {
        registry.fireHandlers.delete(handler);
      };
    },
    replay: (rule, journeys) => engine.replay(rule, journeys),
    get current() {
      return { version: engine.version, rules: engine.rules };
    },
    get historyProvider() {
      return registry.history;
    },
  };
}

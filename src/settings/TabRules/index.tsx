/*
 * The Rules tab: the list with its switches and the builder for one rule, every save through
 * `useTask` so success and errors are toasts.
 */

/**
 * WordPress dependencies.
 */
import apiFetch from "@wordpress/api-fetch";
import { __, sprintf } from "@wordpress/i18n";
import { useEffect, useMemo, useRef, useState } from "@wordpress/element";
import {
  Button,
  Notice,
  ProgressBar,
  ToggleControl,
} from "@wordpress/components";
import { AlertDialog, Badge, Card, Stack, Text } from "@wordpress/ui";

/**
 * Internal dependencies.
 */
import { TabHeading } from "../TabHeading";
import { RuleEditor } from "./RuleEditor";
import { firedHistory, replayRule } from "./ReplayPanel";
import { getRules, saveRules } from "../api";
import {
  newId,
  newRule,
  summarize,
  unavailableKeys,
  type ListedRule,
  type RulesListing,
} from "./model";
import { RulesProvider } from "./context";
// Hooks
import { useTask } from "../useTask";
import { useUrlParam } from "../useUrlParam";
import { useLeaveGuard } from "../useUnsavedChanges";
import { useJourneys } from "./useJourneys";
// Types
import type { Rule } from "../../rules/types";
import type { PatternOption } from "./ValueControl";

/** The saved shape, stripped of what the listing adds. */
function toSaved(rule: ListedRule): Rule {
  const { unavailable, ...saved } = rule;
  void unavailable;
  return saved;
}

export function TabRules({ title }: { title: string }) {
  const [listing, setListing] = useState<RulesListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  /*
   * The open moment is in the URL (`moment=<id>`, or `new`) as a history entry, so a refresh
   * reopens it and Back and Forward step through; a moment not yet saved (new, a copy) is `new`,
   * and reopens empty. A tab switch drops the parameter (`AppSettings.tsx`).
   */
  const [momentId, setMomentId] = useUrlParam("moment", { push: true });
  const guard = useLeaveGuard();
  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [deleting, setDeleting] = useState<ListedRule | null>(null);
  const history = useJourneys();
  /*
   * Closing the builder or deleting a row leaves nothing under the pointer, so focus goes to "Add
   * rule" once the list is back.
   */
  const addRef = useRef<HTMLButtonElement>(null);
  const refocusAdd = useRef(false);
  useEffect(() => {
    if (!editing && refocusAdd.current) {
      refocusAdd.current = false;
      addRef.current?.focus();
    }
  });

  useEffect(() => {
    getRules()
      .then(setListing)
      .catch((error: { message?: string }) =>
        setLoadError(
          error?.message ||
            __("The moments could not be loaded.", "wordsocket"),
        ),
      );
    apiFetch<Array<{ id: number; title: { raw: string } }>>({
      path: "/wp/v2/blocks?per_page=100&status=publish&_fields=id,title",
    })
      .then((blocks) =>
        setPatterns(
          blocks.map((b) => ({
            id: b.id,
            title: `#${b.id} ${b.title?.raw}`,
          })),
        ),
      )
      .catch(() => setPatterns([]));
  }, []);

  /** Open the builder on a rule; `saved` is whether the listing has it. */
  const openRule = (rule: Rule, saved: boolean) => {
    setEditing(rule);
    setMomentId(saved ? rule.id : "new");
  };
  /* Closing replaces the entry the open pushed, so Back never walks through every open and close. */
  const closeRule = () => {
    setEditing(null);
    setMomentId(null, { push: false });
  };
  /* `editing` follows the parameter: a refresh, Back or Forward opens or closes the builder. */
  useEffect(() => {
    if (!listing) return;
    if (!momentId) {
      if (editing) setEditing(null);
      return;
    }
    const isSaved = (id: string) => listing.rules.some((r) => r.id === id);
    const matches =
      editing &&
      (momentId === "new" ? !isSaved(editing.id) : editing.id === momentId);
    if (matches) return;
    if (momentId === "new") {
      setEditing(newRule(listing.vocabulary, listing.kinds));
      return;
    }
    const found = listing.rules.find((rule) => rule.id === momentId);
    if (found) setEditing(toSaved(found));
    // An id the listing lacks is corrected in place, so Back cannot land on it again.
    else setMomentId(null, { push: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing, momentId]);

  /* Every rule's firings over the stored journeys, by id, once per listing or journeys change. */
  const fired = useMemo(
    () =>
      new Map(
        (listing?.rules ?? []).map((rule) => [
          rule.id,
          history.journeys ? firedHistory(rule.id, history.journeys) : null,
        ]),
      ),
    [listing?.rules, history.journeys],
  );
  /* Every rule's reach over the same journeys, once per listing or journeys change, not per render. */
  const reaches = useMemo(
    () =>
      new Map(
        (listing?.rules ?? []).map((rule) => [
          rule.id,
          history.journeys
            ? replayRule(toSaved(rule), history.journeys, false)
            : null,
        ]),
      ),
    [listing?.rules, history.journeys],
  );

  const save = useTask((rules: Rule[]) => saveRules({ rules }), {
    success: __("Moments saved.", "wordsocket"),
    error: __("The moments could not be saved.", "wordsocket"),
    onSuccess: (fresh) => {
      setListing(fresh);
      closeRule();
    },
    onError: () => {
      // The list is re-read so an optimistic switch rolls back to the truth.
      getRules()
        .then(setListing)
        .catch(() => undefined);
    },
  });

  /* The builder's context, once per listing, patterns or journeys change; above the early returns, since it is a hook. */
  const data = useMemo(
    () =>
      listing
        ? {
            vocabulary: listing.vocabulary,
            kinds: listing.kinds,
            kindGroups: listing.kindGroups ?? [],
            patterns,
            history,
          }
        : null,
    [listing, patterns, history],
  );

  if (loadError) {
    return (
      <Stack direction="column" gap="lg" className="wpsignal-rules-tab">
        <TabHeading title={title} />
        <Notice status="error" isDismissible={false}>
          {loadError}
        </Notice>
      </Stack>
    );
  }
  if (!listing) {
    return (
      <Stack direction="column" gap="lg" className="wpsignal-rules-tab">
        <TabHeading title={title} />
        <ProgressBar className="wpsignal-progress-bar" />
      </Stack>
    );
  }

  const { rules, vocabulary, kinds } = listing;
  const reach = (rule: ListedRule) => reaches.get(rule.id) ?? null;
  const allSaved = rules.map(toSaved);
  const persist = (next: Rule[]) => save.run(next);

  const setEnabled = (rule: ListedRule, enabled: boolean) => {
    setListing({
      ...listing,
      rules: rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
    });
    persist(allSaved.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
  };
  const remove = (rule: ListedRule) =>
    persist(allSaved.filter((r) => r.id !== rule.id));
  const duplicate = (rule: ListedRule) => {
    const copy = {
      ...toSaved(rule),
      id: newId(),
      name: sprintf(
        /* translators: %s: rule name */ __("%s (copy)", "wordsocket"),
        rule.name,
      ),
      enabled: false,
      rev: 0,
    };
    delete copy.source;
    openRule(copy, false);
  };
  const saveRule = (rule: Rule) => {
    const exists = allSaved.some((r) => r.id === rule.id);
    persist(
      exists
        ? allSaved.map((r) => (r.id === rule.id ? rule : r))
        : [...allSaved, rule],
    );
  };

  if (editing) {
    return (
      <Stack direction="column" gap="lg" className="wpsignal-rules-tab">
        <TabHeading
          title={
            allSaved.some((r) => r.id === editing.id)
              ? __("Edit Moment", "wordsocket")
              : __("New Moment", "wordsocket")
          }
          beforeTitle={
            <Button
              style={{ padding: 0 }}
              size="small"
              variant="link"
              onClick={() => guard(closeRule)}
            >
              {__("Back", "wordsocket")}
            </Button>
          }
        />
        <RulesProvider value={data}>
          <RuleEditor
            rule={editing}
            saving={save.isPending}
            onSave={saveRule}
            onCancel={() =>
              guard(() => {
                refocusAdd.current = true;
                closeRule();
              })
            }
          />
        </RulesProvider>
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap="lg" className="wpsignal-rules-tab">
      <TabHeading title={title} />
      <Text render={<p />}>
        {__(
          "A moment watches each visitor in their own browser and steps in when its conditions come true: a prompt, and the tab title while they are away. Nothing fires until a moment is on.",
          "wordsocket",
        )}
      </Text>
      {rules.length === 0 ? (
        <Text className="wpsignal-rules-empty wpsignal-muted" render={<p />}>
          {__("No moments yet.", "wordsocket")}
        </Text>
      ) : (
        <Stack direction="column" gap="md" className="wpsignal-rules-list">
          {rules.map((rule) => {
            const unavailable = unavailableKeys(rule);
            return (
              <Card.Root
                key={rule.id}
                className="wpsignal-rule-row"
                data-rule-id={rule.id}
                data-enabled={rule.enabled ? "1" : "0"}
              >
                <Card.Header>
                  <Stack
                    direction="row"
                    gap="sm"
                    align="center"
                    wrap="wrap"
                    justify="space-between"
                  >
                    <Card.Title>{rule.name}</Card.Title>
                    <Stack direction="row" gap="xs" wrap="wrap">
                      {rule.frequency !== "always" && (
                        <Badge intent="draft">
                          {rule.frequency === "page"
                            ? __("per page view", "wordsocket")
                            : rule.frequency === "visit"
                            ? __("once per visit", "wordsocket")
                            : __("once per visitor", "wordsocket")}
                        </Badge>
                      )}
                      {rule.source && (
                        <Badge intent="informational">
                          {sprintf(
                            /* translators: %s: the plugin that shipped the rule */ __(
                              "from %s",
                              "wordsocket",
                            ),
                            rule.source,
                          )}
                        </Badge>
                      )}
                      {unavailable.length > 0 && (
                        <Badge intent="high">
                          {sprintf(
                            /* translators: %s: condition or action keys */ __(
                              "needs %s",
                              "wordsocket",
                            ),
                            unavailable.join(", "),
                          )}
                        </Badge>
                      )}
                    </Stack>
                  </Stack>
                </Card.Header>
                <Card.Content>
                  <Stack
                    direction="row"
                    gap="lg"
                    align="flex-start"
                    justify="space-between"
                    wrap="wrap"
                  >
                    <Stack
                      direction="column"
                      gap="lg"
                      className="wpsignal-rule-item"
                    >
                      <ToggleControl
                        label={__("Enabled", "wordsocket")}
                        checked={rule.enabled}
                        disabled={save.isPending || unavailable.length > 0}
                        onChange={(enabled) => setEnabled(rule, enabled)}
                        __nextHasNoMarginBottom
                      />
                      <Text
                        variant="body-sm"
                        className="wpsignal-rule-summary wpsignal-muted"
                        render={<p />}
                      >
                        {summarize(rule, vocabulary, kinds, patterns)}
                      </Text>
                      <Stack direction="row" gap="xs" wrap="wrap">
                        <Button
                          size="small"
                          variant="primary"
                          onClick={() => openRule(toSaved(rule), true)}
                        >
                          {__("Edit", "wordsocket")}
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => duplicate(rule)}
                        >
                          {__("Duplicate", "wordsocket")}
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          isDestructive
                          onClick={() => setDeleting(rule)}
                        >
                          {__("Delete", "wordsocket")}
                        </Button>
                      </Stack>
                    </Stack>
                    {history.journeys && (
                      <Stack
                        direction="column"
                        gap="xs"
                        align="flex-end"
                        style={{
                          padding: "0.5rem",
                          backgroundColor:
                            "var(--wpds-color-background-surface-neutral-weak)",
                          borderRadius: "0.5rem",
                        }}
                        title={__(
                          "Journeys stored in the last 28 days this moment would have happened in",
                          "wordsocket",
                        )}
                      >
                        <Text variant="heading-2xl">
                          {reach(rule)?.count ?? 0}
                        </Text>
                        <Text variant="body-sm" className="wpsignal-muted">
                          {sprintf(
                            /* translators: %d: journeys replayed */ __(
                              "of %d reached",
                              "wordsocket",
                            ),
                            history.journeys.length,
                          )}
                        </Text>
                        {(fired.get(rule.id)?.shown ?? 0) > 0 && (
                          <Text variant="body-sm" className="wpsignal-muted">
                            {(fired.get(rule.id)?.orders ?? 0) > 0
                              ? sprintf(
                                  /* translators: 1: times shown, 2: orders credited */
                                  __("fired %1$d, %2$d orders", "wordsocket"),
                                  fired.get(rule.id)!.shown,
                                  fired.get(rule.id)!.orders,
                                )
                              : sprintf(
                                  /* translators: %d: times shown */
                                  __("fired %d", "wordsocket"),
                                  fired.get(rule.id)!.shown,
                                )}
                          </Text>
                        )}
                      </Stack>
                    )}
                  </Stack>
                </Card.Content>
              </Card.Root>
            );
          })}
        </Stack>
      )}
      {/* A rule may be live on every visitor's page, so Delete asks first. The dialog is one for the list, opened for the row in `deleting`. */}
      <AlertDialog.Root
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={async () => {
          if (deleting) await remove(deleting);
          setDeleting(null);
          refocusAdd.current = true;
          return { close: true };
        }}
      >
        <AlertDialog.Popup
          intent="irreversible"
          title={__("Delete this moment?", "wordsocket")}
          description={
            deleting
              ? sprintf(
                  /* translators: %s: rule name */ __(
                    '"%s" stops for every visitor as soon as it is deleted. Nothing already shown is taken back.',
                    "wordsocket",
                  ),
                  deleting.name,
                )
              : ""
          }
          confirmButtonText={__("Delete", "wordsocket")}
        />
      </AlertDialog.Root>
      <Stack direction="row">
        <Button
          ref={addRef}
          variant="primary"
          className="wpsignal-rules-add"
          onClick={() => openRule(newRule(vocabulary, kinds), false)}
          disabled={save.isPending}
        >
          {__("Add a moment", "wordsocket")}
        </Button>
      </Stack>
    </Stack>
  );
}

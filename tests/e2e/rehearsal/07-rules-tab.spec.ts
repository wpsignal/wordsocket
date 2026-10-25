import "../env";
import { expect, test } from "@wordpress/e2e-test-utils-playwright";
import type { Locator, Page } from "@playwright/test";
import { wp } from "../env";
import { waitForState } from "./helpers";

/*
 * The Rules tab (0.31): building, enabling, editing and deleting a rule on
 * WordSocket's settings page, the builder's all/any sentence with a nested
 * group, and what each change does to an open storefront tab.
 */

const TAB = "page=wordsocket&tab=moments";

async function arrive(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForState(page, { connected: true, transport: "ws" });
}

/** The builder's selects are `@wordpress/ui` comboboxes over a listbox, not native selects. */
async function choose(
  page: Page,
  control: Locator,
  option: string,
): Promise<void> {
  await control.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function forget(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem("wordsocket-rules");
    window.sessionStorage.removeItem("wordsocket-rules-state");
    window.sessionStorage.removeItem("wordsocket-rules-visit");
    window.sessionStorage.removeItem("wordsocket-journey");
  });
}

test.describe("Rules tab", () => {
  let postUrl = "";

  test.beforeAll(async ({ requestUtils }) => {
    const post = (await requestUtils.rest({
      method: "POST",
      path: "/wp/v2/posts",
      data: {
        title: "E2E rules tab post",
        status: "publish",
        content: "<p>Read me</p>",
      },
    })) as { link: string };
    postUrl = post.link;
  });

  test.beforeEach(() => {
    wp("option", "delete", "wpsignal_rules");
  });

  test.afterAll(() => {
    wp("option", "delete", "wpsignal_rules");
  });

  test("the tab is linkable and starts empty, and Add rule opens the builder", async ({
    admin,
    page,
  }) => {
    await admin.visitAdminPage("admin.php", TAB);
    await expect(page.getByRole("tab", { name: "Moments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".wpsignal-rules-empty")).toHaveText(
      "No moments yet.",
    );
    await page.getByRole("button", { name: "Add a moment" }).click();
    const editor = page.locator(".wpsignal-rule-editor");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".wpsignal-rule-condition")).toHaveCount(1);
    await expect(editor.locator(".wpsignal-rule-action")).toHaveCount(1);
    await expect(editor.locator(".wpsignal-rule-replay")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".wpsignal-rules-empty")).toBeVisible();
  });

  test("the open moment is in the URL and survives a refresh, and leaving unsaved changes asks first", async ({
    admin,
    page,
    requestUtils,
  }) => {
    await requestUtils.rest({
      method: "POST",
      path: "/wpsignal/v1/rules",
      data: {
        rules: [
          {
            id: "e2e-linked",
            name: "Linked moment",
            enabled: false,
            frequency: "visitor",
            conditions: {
              all: [{ condition: "page_kind", op: "is", value: "post" }],
            },
            actions: [
              {
                action: "show",
                presentation: { type: "banner", pattern: 0, text: "Hello" },
              },
            ],
          },
        ],
      },
    });
    await admin.visitAdminPage("admin.php", TAB);
    const editor = page.locator(".wpsignal-rule-editor");

    // A new moment is `moment=new`, and comes back empty after a refresh.
    await page.getByRole("button", { name: "Add a moment" }).click();
    await expect(page).toHaveURL(/[?&]moment=new(&|$)/);
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("Name")).toHaveValue("");
    // Nothing changed, so Back asks nothing.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(editor).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]moment=/);

    // A saved moment is `moment=<id>` and reopens with its name.
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page).toHaveURL(/[?&]moment=e2e-linked(&|$)/);
    await page.reload();
    await expect(editor.getByLabel("Name")).toHaveValue("Linked moment");
    // The moment is a history entry: Back closes it, Forward reopens it.
    await page.goBack();
    await expect(editor).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]moment=/);
    await page.goForward();
    await expect(editor.getByLabel("Name")).toHaveValue("Linked moment");

    // A change makes Back, Cancel, the tabs and the browser's Back ask; keeping the changes stays put.
    await editor.getByLabel("Name").fill("Linked moment, renamed");
    await page.getByRole("button", { name: "Back" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Discard changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.goBack();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(editor.getByLabel("Name")).toHaveValue(
      "Linked moment, renamed",
    );
    await expect(page).toHaveURL(/[?&]moment=e2e-linked(&|$)/);
    await expect(editor.getByLabel("Name")).toHaveValue(
      "Linked moment, renamed",
    );
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("tab", { name: "Moments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(editor).toBeVisible();
    // Discarding leaves, and the name is untouched.
    await editor.getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".wpsignal-rule-row")).toContainText(
      "Linked moment",
    );
    await expect(page).not.toHaveURL(/[?&]moment=/);

    // Leaving for another tab drops the moment; Back from there lands on the Moments list.
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page).toHaveURL(/[?&]tab=settings(&|$)/);
    await expect(page).not.toHaveURL(/[?&]moment=/);
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Moments" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".wpsignal-rule-row")).toContainText(
      "Linked moment",
    );
    await expect(editor).toHaveCount(0);
  });

  test("the builder matches all or any of the conditions and nests a group of the other kind", async ({
    admin,
    page,
    requestUtils,
  }) => {
    await admin.visitAdminPage("admin.php", TAB);
    await page.getByRole("button", { name: "Add a moment" }).click();
    const editor = page.locator(".wpsignal-rule-editor");
    await editor.getByLabel("Name").fill("Either way");
    // The top sentence reads "If all of these are true"; switch it to any, then add a group: it starts as all, the other kind.
    const top = editor.locator(".wpsignal-rule-group").first();
    await expect(top.getByRole("combobox", { name: "Match" })).toHaveText(
      "all of these",
    );
    await choose(
      page,
      top.getByRole("combobox", { name: "Match" }),
      "any of these",
    );
    await page.getByRole("button", { name: "Add a group" }).click();
    const nested = editor.locator(".wpsignal-rule-group").nth(1);
    // A nested group is always the other kind to its parent, stated rather than offered.
    await expect(nested.locator(".wpsignal-rule-group__mode")).toHaveText(
      "all of these",
    );
    await expect(nested.locator(".wpsignal-rule-condition")).toHaveCount(1);
    await nested.getByRole("button", { name: "Add a condition" }).click();
    await expect(nested.locator(".wpsignal-rule-condition")).toHaveCount(2);
    await expect(editor.locator(".wpsignal-rule-join")).toHaveText([
      "or",
      "and",
    ]);
    await page.getByRole("button", { name: "Save moment" }).click();
    await expect(editor).toHaveCount(0, { timeout: 10_000 });

    await expect(page.locator(".wpsignal-rule-summary")).toContainText(
      "If page is Post or (page is Post and page is Post), then Show",
    );
    const saved = (await requestUtils.rest({ path: "/wpsignal/v1/rules" })) as {
      rules: Array<{ conditions: { any?: Array<{ all?: unknown[] }> } }>;
    };
    expect(saved.rules[0].conditions.any).toHaveLength(2);
    expect(saved.rules[0].conditions.any?.[1].all).toHaveLength(2);
  });

  test("conditions reorder within their group by the arrow keys on a grip and by a drag", async ({
    admin,
    page,
    requestUtils,
  }) => {
    await admin.visitAdminPage("admin.php", TAB);
    await page.getByRole("button", { name: "Add a moment" }).click();
    const editor = page.locator(".wpsignal-rule-editor");
    await editor.getByLabel("Name").fill("In order");
    await page.getByRole("button", { name: "Add a condition" }).click();
    const conditions = editor.locator(".wpsignal-rule-condition");
    await choose(
      page,
      conditions.nth(1).getByRole("combobox", { name: "Condition" }),
      "Logged in",
    );
    const order = () =>
      conditions.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-condition")),
      );
    expect(await order()).toEqual(["page_kind", "logged_in"]);

    // The arrow keys on a focused grip, which keeps focus on the moved item.
    const slots = editor.locator(".wpsignal-rule-slot");
    const grip = (name: string) =>
      editor.getByRole("button", { name: new RegExp(`^Move ${name} `) });
    await grip("Logged in").focus();
    await page.keyboard.press("ArrowLeft");
    expect(await order()).toEqual(["logged_in", "page_kind"]);
    await expect(page.locator(":focus")).toHaveAttribute(
      "data-handle-index",
      "0",
    );
    await page.keyboard.press("End");
    expect(await order()).toEqual(["page_kind", "logged_in"]);

    // A drag of the grip onto the left half of the first slot.
    await grip("Logged in").dragTo(slots.nth(0), {
      targetPosition: { x: 6, y: 12 },
    });
    expect(await order()).toEqual(["logged_in", "page_kind"]);
    await expect(editor.locator("[data-drop]")).toHaveCount(0);

    await page.getByRole("button", { name: "Save moment" }).click();
    await expect(editor).toHaveCount(0, { timeout: 10_000 });
    const saved = (await requestUtils.rest({ path: "/wpsignal/v1/rules" })) as {
      rules: Array<{ conditions: { all: Array<{ condition: string }> } }>;
    };
    expect(saved.rules[0].conditions.all.map((c) => c.condition)).toEqual([
      "logged_in",
      "page_kind",
    ]);
  });

  test("a rule built in the tab is saved disabled, enabled by its switch, re-armed by an edit, and taken back when deleted", async ({
    admin,
    page,
    browser,
    baseURL,
    requestUtils,
  }) => {
    test.setTimeout(120_000);
    await admin.visitAdminPage("admin.php", TAB);
    await page.getByRole("button", { name: "Add a moment" }).click();
    const editor = page.locator(".wpsignal-rule-editor");
    await editor.getByLabel("Name").fill("Readers who linger");

    // If: page kind is post (the first condition's defaults) and dwell at least 1 s.
    await page.getByRole("button", { name: "Add a condition" }).click();
    const second = editor.locator(".wpsignal-rule-condition").nth(1);
    await choose(
      page,
      second.getByRole("combobox", { name: "Condition" }),
      "Time on page while visible (seconds)",
    );
    await second.getByLabel("Value").fill("1");
    // Then: show a banner with text.
    const action = editor.locator(".wpsignal-rule-action").first();
    await action.getByLabel("Text").fill("Still reading, {site.name}?");
    await choose(
      page,
      action.getByRole("combobox", { name: "Show as" }),
      "banner at the top",
    );
    await page.getByRole("button", { name: "Save moment" }).click();
    await expect(editor).toHaveCount(0, { timeout: 10_000 });

    const row = page.locator(".wpsignal-rule-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-enabled", "0");
    await expect(row.locator(".wpsignal-rule-summary")).toHaveText(
      'If page is Post and time on page while visible (seconds) at least 1, then Show banner at the top saying "Still reading, {site.name}?".',
    );
    const saved = (await requestUtils.rest({ path: "/wpsignal/v1/rules" })) as {
      rules: Array<{ id: string; enabled: boolean; rev: number }>;
    };
    expect(saved.rules[0].enabled).toBe(false);
    expect(saved.rules[0].rev).toBe(1);
    const id = saved.rules[0].id;

    // A reader in another context sees nothing while the rule is off, the banner once it is on.
    const other = await browser.newContext({
      baseURL,
      ignoreHTTPSErrors: true,
      storageState: await page.context().storageState(),
    });
    try {
      const reader = await other.newPage();
      await arrive(reader, "/");
      await forget(reader);
      await arrive(reader, postUrl);
      await reader.waitForTimeout(2_500);
      await expect(reader.locator(".wordsocket-prompt")).toHaveCount(0);

      await row.getByRole("checkbox").check();
      await expect(row).toHaveAttribute("data-enabled", "1");
      await expect
        .poll(
          async () =>
            (
              (await requestUtils.rest({ path: "/wpsignal/v1/rules" })) as {
                rules: Array<{ enabled: boolean }>;
              }
            ).rules[0].enabled,
          { timeout: 10_000 },
        )
        .toBe(true);
      // The broadcast reaches the reader mid-page; edge triggered, so a transition is needed.
      await expect
        .poll(
          () => reader.evaluate(() => window.WPS!.rules.current.rules.length),
          { timeout: 15_000 },
        )
        .toBe(1);
      await arrive(reader, "/");
      await arrive(reader, postUrl);
      const banner = reader.locator(".wordsocket-prompt--banner");
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toContainText("Still reading,");

      // An edit bumps the revision and re-arms: the reader, still on the post, sees nothing new until the next transition.
      await row.getByRole("button", { name: "Edit" }).click();
      await editor
        .locator(".wpsignal-rule-action")
        .first()
        .getByLabel("Text")
        .fill("Second wind");
      await page.getByRole("button", { name: "Save moment" }).click();
      // The editor closes only when the save succeeded; a toast from the earlier enable may still be on screen.
      await expect(editor).toHaveCount(0, { timeout: 10_000 });
      const edited = (await requestUtils.rest({
        path: "/wpsignal/v1/rules",
      })) as { rules: Array<{ id: string; rev: number }> };
      // The enable kept the revision (a pause or resume is not an edit); the edit bumped it.
      expect(edited.rules.find((r) => r.id === id)?.rev).toBe(2);
      await expect
        .poll(
          () => reader.evaluate(() => window.WPS!.rules.current.rules[0]?.rev),
          { timeout: 15_000 },
        )
        .toBe(2);
      // The edit takes the first banner back (its `id:rev` is gone) and does not fire by itself.
      await expect(reader.locator(".wordsocket-prompt--banner")).toHaveCount(0);
      await reader.waitForTimeout(2_500);
      await expect(reader.locator(".wordsocket-prompt--banner")).toHaveCount(0);
      // The first firing set the once-per-visit flag (the default): a fresh visit for the next transition.
      await forget(reader);
      await arrive(reader, "/");
      await arrive(reader, postUrl);
      await expect(reader.locator(".wordsocket-prompt--banner")).toContainText(
        "Second wind",
        { timeout: 10_000 },
      );

      // Delete: the open page learns the set is empty and the banner on screen goes with it.
      await page
        .locator(".wpsignal-rule-row")
        .getByRole("button", { name: "Delete" })
        .click();
      // Delete asks first; the dialog's confirm button carries the same name.
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(page.locator(".wpsignal-rules-empty")).toBeVisible({
        timeout: 10_000,
      });
      await expect
        .poll(
          () => reader.evaluate(() => window.WPS!.rules.current.rules.length),
          { timeout: 15_000 },
        )
        .toBe(0);
      await expect(reader.locator(".wordsocket-prompt--banner")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});

/*
 * The Style prompts dialog: one tab for every prompt and one per presentation, each a panel of the
 * fields that scope may set, a sample drawn from the merged values, and one save for all of it.
 */

/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";
import { useMemo, useState } from "@wordpress/element";
import {
  ColorIndicator,
  ColorPalette,
  Dropdown,
  FontSizePicker,
  RangeControl,
  SelectControl,
  ToggleControl,
  __experimentalNumberControl as NumberControl,
  __experimentalToggleGroupControl as ToggleGroupControl,
  __experimentalToggleGroupControlOption as ToggleGroupControlOption,
  __experimentalToolsPanel as ToolsPanel,
  __experimentalToolsPanelItem as ToolsPanelItem,
} from "@wordpress/components";
import apiFetch from "@wordpress/api-fetch";
import { Button, ButtonLink, Dialog, Stack, Tabs, Text } from "@wordpress/ui";
import { Button as WpButton } from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { useTask } from "../useTask";

type Styles = Record<PromptStyleScope, PromptStyleValues>;
type Field = keyof PromptStyleValues;

const SCOPES: PromptStyleScope[] = [
  "all",
  "modal",
  "banner",
  "bar",
  "toast",
  "panel",
];
const CUSTOM = "__custom";
/** What the stylesheet gives a field nothing sets, which an unset control shows and a field added from the panel's menu starts at. */
const STYLESHEET_DEFAULTS = {
  radius: 8,
  padding: "40",
  fontSize: "medium",
  shadow: true,
  close: true,
  motion: "slide",
  overlay: "#00000066",
} as const satisfies PromptStyleValues;
/** The stylesheet's width for a presentation that has one. */
const defaultWidth = (scope: PromptStyleScope) =>
  scope === "panel" ? 400 : 480;

/** The scope labels, the presentations named as the Then chip names them. */
function scopeLabel(scope: PromptStyleScope): string {
  switch (scope) {
    case "all":
      return __("All prompts", "wordsocket");
    case "modal":
      return __("Modal", "wordsocket");
    case "banner":
      return __("Banner", "wordsocket");
    case "bar":
      return __("Bar", "wordsocket");
    case "toast":
      return __("Toast", "wordsocket");
    case "panel":
      return __("Panel", "wordsocket");
  }
}

function fieldLabel(field: Field): string {
  switch (field) {
    case "background":
      return __("Background", "wordsocket");
    case "text":
      return __("Text", "wordsocket");
    case "border":
      return __("Border", "wordsocket");
    case "radius":
      return __("Corner radius", "wordsocket");
    case "padding":
      return __("Padding", "wordsocket");
    case "fontSize":
      return __("Font size", "wordsocket");
    case "shadow":
      return __("Shadow", "wordsocket");
    case "close":
      return __("Close button", "wordsocket");
    case "motion":
      return __("Motion", "wordsocket");
    case "width":
      return __("Width", "wordsocket");
    case "overlay":
      return __("Overlay", "wordsocket");
  }
}

/** A colour as CSS: a hex as is, a slug as the theme's preset with its value as the fallback. */
function colorCss(value: string, palette: PromptStylePreset[]): string {
  if (value.startsWith("#")) return value;
  const preset = palette.find((p) => p.slug === value);
  return `var(--wp--preset--color--${value}${
    preset?.color ? `, ${preset.color}` : ""
  })`;
}

/** A size as CSS: pixels as is, a slug as the theme's preset with its value as the fallback. */
function sizeCss(
  value: number | string,
  kind: "spacing" | "font-size",
  presets: PromptStylePreset[],
  literal: string,
): string {
  if (typeof value === "number") return `${value}px`;
  const preset = presets.find((p) => p.slug === value);
  return `var(--wp--preset--${kind}--${value}, ${preset?.size ?? literal})`;
}

/** The custom properties one style sets, as PHP prints them, for the sample. */
function varsOf(
  style: PromptStyleValues,
  presets: WpSignalPromptStyle["presets"],
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (style.background)
    vars["--wordsocket-prompt-bg"] = colorCss(
      style.background,
      presets.palette,
    );
  if (style.text)
    vars["--wordsocket-prompt-fg"] = colorCss(style.text, presets.palette);
  if (style.border)
    vars["--wordsocket-prompt-border"] = colorCss(
      style.border,
      presets.palette,
    );
  if (style.radius !== undefined)
    vars["--wordsocket-prompt-radius"] = `${style.radius}px`;
  /* The stylesheet's default is the theme's `40` spacing, which the settings page does not print, so the sample resolves it itself. */
  vars["--wordsocket-prompt-padding"] = sizeCss(
    style.padding ?? STYLESHEET_DEFAULTS.padding,
    "spacing",
    presets.spacingSizes,
    "16px",
  );
  if (style.fontSize !== undefined)
    vars["--wordsocket-prompt-font-size"] = sizeCss(
      style.fontSize,
      "font-size",
      presets.fontSizes,
      "15px",
    );
  if (style.shadow !== undefined)
    vars["--wordsocket-prompt-shadow"] = style.shadow
      ? "0 8px 24px rgb(0 0 0 / 0.16)"
      : "none";
  if (style.close !== undefined) {
    vars["--wordsocket-prompt-close"] = style.close ? "block" : "none";
    vars["--wordsocket-prompt-close-room"] = style.close ? "28px" : "0px";
  }
  if (style.width !== undefined)
    vars["--wordsocket-prompt-width"] = `${style.width}px`;
  if (style.overlay !== undefined)
    vars["--wordsocket-prompt-overlay"] =
      style.overlay === "none"
        ? "transparent"
        : colorCss(style.overlay, presets.palette);
  return vars;
}

/** The colour a picker shows for a stored value. */
function colorShown(
  value: string | undefined,
  palette: PromptStylePreset[],
): string | undefined {
  if (!value || value === "none") return undefined;
  return value.startsWith("#")
    ? value
    : palette.find((p) => p.slug === value)?.color;
}

/** The stored value for a colour a picker returned: the preset's slug when it is one of them. */
function colorStored(
  color: string | undefined,
  palette: PromptStylePreset[],
): string | undefined {
  if (!color) return undefined;
  const preset = palette.find(
    (p) => p.color?.toLowerCase() === color.toLowerCase(),
  );
  return preset ? preset.slug : color.toLowerCase();
}

interface ColorRowProps {
  label: string;
  value: string | undefined;
  palette: PromptStylePreset[];
  enableAlpha?: boolean;
  clearable?: boolean;
  onChange: (stored: string | undefined) => void;
}

/** A colour as the block inspector shows one: an indicator and the chosen name, the palette in a popover. */
function ColorRow({
  label,
  value,
  palette,
  enableAlpha = false,
  clearable = true,
  onChange,
}: ColorRowProps) {
  const shown = colorShown(value, palette);
  const name = value
    ? palette.find((p) => p.slug === value)?.name ?? value
    : __("Default", "wordsocket");
  return (
    <Dropdown
      popoverProps={{ placement: "left-start", offset: 36, shift: true }}
      renderToggle={({ isOpen, onToggle }) => (
        <WpButton
          className="wpsignal-prompt-style-color"
          onClick={onToggle}
          aria-expanded={isOpen}
          __next40pxDefaultSize
        >
          <ColorIndicator colorValue={shown ?? "transparent"} />
          <span className="wpsignal-prompt-style-color__label">{label}</span>
          <span className="wpsignal-muted">{name}</span>
        </WpButton>
      )}
      renderContent={() => (
        <div className="wpsignal-prompt-style-color__popover">
          <ColorPalette
            colors={palette.map((p) => ({
              name: p.name,
              color: p.color ?? "",
              slug: p.slug,
            }))}
            value={shown}
            onChange={(color) => onChange(colorStored(color, palette))}
            clearable={clearable}
            enableAlpha={enableAlpha}
          />
        </div>
      )}
    />
  );
}

interface ScopePanelProps {
  scope: PromptStyleScope;
  values: PromptStyleValues;
  inherited: PromptStyleValues;
  config: WpSignalPromptStyle;
  onChange: (values: PromptStyleValues) => void;
}

/** One scope's fields: those set here, and in the panel's menu those it may still set. */
function ScopePanel({
  scope,
  values,
  inherited,
  config,
  onChange,
}: ScopePanelProps) {
  const { presets, fields } = config;
  const allowed = (Object.keys(fields) as Field[]).filter((field) =>
    fields[field].scopes.includes(scope),
  );
  const set = <K extends Field>(field: K, value: PromptStyleValues[K]) =>
    onChange({ ...values, [field]: value });
  const unset = (field: Field) => {
    const next = { ...values };
    delete next[field];
    onChange(next);
  };
  /* What a field starts at when its item is added from the panel's menu: what the control shows. */
  const shown = (field: Field): PromptStyleValues[Field] => {
    switch (field) {
      case "width":
        return defaultWidth(scope);
      case "overlay":
        return STYLESHEET_DEFAULTS.overlay;
      default:
        return (
          inherited[field] ?? (STYLESHEET_DEFAULTS as PromptStyleValues)[field]
        );
    }
  };
  const item = (field: Field, control: JSX.Element) => (
    <ToolsPanelItem
      key={field}
      hasValue={() => values[field] !== undefined}
      label={fieldLabel(field)}
      onSelect={() => {
        const start = shown(field);
        if (start !== undefined) onChange({ ...values, [field]: start });
      }}
      onDeselect={() => unset(field)}
      isShownByDefault={scope === "all"}
      panelId={scope}
    >
      {control}
    </ToolsPanelItem>
  );
  const colorControl = (field: "background" | "text" | "border") => (
    <ColorRow
      label={fieldLabel(field)}
      value={values[field] ?? inherited[field]}
      palette={presets.palette}
      onChange={(stored) => (stored ? set(field, stored) : unset(field))}
    />
  );
  const spacingOptions = [
    ...presets.spacingSizes.map((p) => ({ label: p.name, value: p.slug })),
    { label: __("Custom", "wordsocket"), value: CUSTOM },
  ];
  /* The stylesheet's own default is the theme's `40` spacing, so an unset field shows that. */
  const padding =
    values.padding ?? inherited.padding ?? STYLESHEET_DEFAULTS.padding;
  const paddingIsCustom = typeof padding === "number";

  return (
    <ToolsPanel
      label={scopeLabel(scope)}
      panelId={scope}
      resetAll={() => onChange({})}
    >
      {allowed.includes("background") &&
        item("background", colorControl("background"))}
      {allowed.includes("text") && item("text", colorControl("text"))}
      {allowed.includes("border") && item("border", colorControl("border"))}
      {allowed.includes("fontSize") &&
        item(
          "fontSize",
          <FontSizePicker
            fontSizes={presets.fontSizes.map((p) => ({
              name: p.name,
              slug: p.slug,
              size: p.size ?? "",
            }))}
            value={
              typeof (values.fontSize ?? inherited.fontSize) === "number"
                ? `${values.fontSize ?? inherited.fontSize}px`
                : presets.fontSizes.find(
                    (p) => p.slug === (values.fontSize ?? inherited.fontSize),
                  )?.size
            }
            onChange={(size) => {
              if (size === undefined) return unset("fontSize");
              const preset = presets.fontSizes.find((p) => p.size === size);
              const px = parseInt(String(size), 10);
              if (preset) set("fontSize", preset.slug);
              else if (!Number.isNaN(px)) set("fontSize", px);
            }}
            withSlider
            __next40pxDefaultSize
          />,
        )}
      {allowed.includes("padding") &&
        item(
          "padding",
          <Stack direction="column" gap="sm">
            <SelectControl
              label={fieldLabel("padding")}
              options={spacingOptions}
              value={paddingIsCustom ? CUSTOM : String(padding)}
              onChange={(slug) =>
                set(
                  "padding",
                  slug === CUSTOM
                    ? typeof padding === "number"
                      ? padding
                      : 16
                    : slug,
                )
              }
              __next40pxDefaultSize
              __nextHasNoMarginBottom
            />
            {paddingIsCustom && (
              <NumberControl
                label={__("Padding (px)", "wordsocket")}
                min={0}
                max={128}
                value={padding}
                onChange={(px) =>
                  set("padding", Math.max(0, Number(px ?? 0) || 0))
                }
                __next40pxDefaultSize
              />
            )}
          </Stack>,
        )}
      {allowed.includes("radius") &&
        item(
          "radius",
          <RangeControl
            label={fieldLabel("radius")}
            min={fields.radius.min}
            max={fields.radius.max}
            value={
              values.radius ?? inherited.radius ?? STYLESHEET_DEFAULTS.radius
            }
            onChange={(radius) => set("radius", radius ?? 0)}
            __next40pxDefaultSize
            __nextHasNoMarginBottom
          />,
        )}
      {allowed.includes("width") &&
        item(
          "width",
          <RangeControl
            label={__("Width (px)", "wordsocket")}
            min={fields.width.min}
            max={fields.width.max}
            value={values.width ?? defaultWidth(scope)}
            onChange={(width) => set("width", width ?? defaultWidth(scope))}
            __next40pxDefaultSize
            __nextHasNoMarginBottom
          />,
        )}
      {allowed.includes("shadow") &&
        item(
          "shadow",
          <ToggleControl
            label={fieldLabel("shadow")}
            checked={
              values.shadow ?? inherited.shadow ?? STYLESHEET_DEFAULTS.shadow
            }
            onChange={(shadow) => set("shadow", shadow)}
            __nextHasNoMarginBottom
          />,
        )}
      {allowed.includes("close") &&
        item(
          "close",
          <ToggleControl
            label={fieldLabel("close")}
            help={
              scope === "modal" || scope === "all"
                ? __(
                    "A modal without one still closes on Escape and on a click outside it.",
                    "wordsocket",
                  )
                : undefined
            }
            checked={
              values.close ?? inherited.close ?? STYLESHEET_DEFAULTS.close
            }
            onChange={(close) => set("close", close)}
            __nextHasNoMarginBottom
          />,
        )}
      {allowed.includes("motion") &&
        item(
          "motion",
          <ToggleGroupControl
            label={fieldLabel("motion")}
            value={
              values.motion ?? inherited.motion ?? STYLESHEET_DEFAULTS.motion
            }
            onChange={(motion) =>
              set("motion", motion as PromptStyleValues["motion"])
            }
            isBlock
            __next40pxDefaultSize
            __nextHasNoMarginBottom
          >
            <ToggleGroupControlOption
              value="slide"
              label={__("Slide", "wordsocket")}
            />
            <ToggleGroupControlOption
              value="fade"
              label={__("Fade", "wordsocket")}
            />
            <ToggleGroupControlOption
              value="none"
              label={__("None", "wordsocket")}
            />
          </ToggleGroupControl>,
        )}
      {allowed.includes("overlay") &&
        item(
          "overlay",
          <Stack direction="column" gap="sm">
            <ToggleControl
              label={__("Dim the page behind", "wordsocket")}
              checked={values.overlay !== "none"}
              onChange={(dim) =>
                set("overlay", dim ? STYLESHEET_DEFAULTS.overlay : "none")
              }
              __nextHasNoMarginBottom
            />
            {values.overlay !== "none" && (
              <ColorRow
                label={__("Overlay colour", "wordsocket")}
                value={values.overlay}
                palette={presets.palette}
                enableAlpha
                clearable={false}
                onChange={(stored) =>
                  set("overlay", stored ?? STYLESHEET_DEFAULTS.overlay)
                }
              />
            )}
          </Stack>,
        )}
    </ToolsPanel>
  );
}

/** A prompt drawn with the merged style, in the dialog rather than on the page. */
function Sample({
  scope,
  vars,
  text,
}: {
  scope: PromptStyleScope;
  vars: Record<string, string>;
  text: string;
}) {
  return (
    <Stack direction="column" gap="sm" className="wpsignal-prompt-sample-wrap">
      <Text variant="body-sm" className="wpsignal-muted">
        {__("Preview", "wordsocket")}
      </Text>
      <div
        className="wordsocket-prompt wpsignal-prompt-sample"
        style={vars as React.CSSProperties}
        data-scope={scope}
        aria-hidden="true"
      >
        <div className="wordsocket-prompt__body">
          <p className="wordsocket-prompt__text">{text}</p>
        </div>
        <button
          type="button"
          className="wordsocket-prompt__close"
          tabIndex={-1}
        >
          ×
        </button>
      </div>
    </Stack>
  );
}

interface PromptStyleDialogProps {
  config: WpSignalPromptStyle;
  onClose: () => void;
  onSaved: (config: WpSignalPromptStyle) => void;
}

/**
 * The Style prompts dialog, open while mounted.
 *
 * @since 0.31.0
 */
export function PromptStyleDialog({
  config,
  onClose,
  onSaved,
}: PromptStyleDialogProps) {
  const [draft, setDraft] = useState<Styles>(config.styles);
  const [scope, setScope] = useState<PromptStyleScope>("all");
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(config.styles),
    [draft, config.styles],
  );
  const save = useTask(
    (styles: Styles) =>
      apiFetch<WpSignalPromptStyle>({
        url: config.url,
        method: "POST",
        data: { styles },
      }),
    {
      success: __("Prompt styles saved.", "wordsocket"),
      error: __("Failed to save the prompt styles.", "wordsocket"),
      onSuccess: (saved) => {
        onSaved(saved);
        onClose();
      },
    },
  );
  const merged = (s: PromptStyleScope): PromptStyleValues =>
    s === "all" ? draft.all : { ...draft.all, ...draft[s] };

  return (
    <Dialog.Root
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Popup className="wpsignal-prompt-style-dialog" size="large">
        <Dialog.Header>
          <Dialog.Title>{__("Style prompts", "wordsocket")}</Dialog.Title>
          <Dialog.CloseIconButton />
        </Dialog.Header>
        <Dialog.Content>
          <Stack direction="column" gap="lg">
            <Text>
              {__(
                "Colours, spacing and sizes come from your theme. All prompts sets the look of every prompt; a prompt type changes only what it sets itself.",
                "wordsocket",
              )}
            </Text>
            <Tabs.Root
              value={scope}
              onValueChange={(value: string) =>
                setScope(value as PromptStyleScope)
              }
            >
              <Tabs.List variant="minimal">
                {SCOPES.map((s) => (
                  <Tabs.Tab key={s} value={s}>
                    {scopeLabel(s)}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              {SCOPES.map((s) => (
                <Tabs.Panel key={s} value={s} tabIndex={-1}>
                  <div className="wpsignal-prompt-style-grid">
                    <ScopePanel
                      scope={s}
                      values={draft[s]}
                      inherited={s === "all" ? {} : draft.all}
                      config={config}
                      onChange={(values) =>
                        setDraft((prev) => ({ ...prev, [s]: values }))
                      }
                    />
                    <Sample
                      scope={s}
                      vars={varsOf(merged(s), config.presets)}
                      text={config.sampleText}
                    />
                  </div>
                </Tabs.Panel>
              ))}
            </Tabs.Root>
          </Stack>
        </Dialog.Content>
        <Dialog.Footer>
          {config.preview && (
            <ButtonLink
              variant="minimal"
              href={`${config.preview}${scope === "all" ? "modal" : scope}`}
              target="_blank"
              rel="noopener noreferrer"
              className="wpsignal-prompt-style-preview"
            >
              {dirty
                ? __("Preview saved styles on site", "wordsocket")
                : __("Preview on site", "wordsocket")}
            </ButtonLink>
          )}
          <Button variant="outline" onClick={onClose}>
            {__("Cancel", "wordsocket")}
          </Button>
          <Button
            variant="solid"
            disabled={!dirty || save.isPending}
            onClick={() => void save.run(draft)}
          >
            {__("Save styles", "wordsocket")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

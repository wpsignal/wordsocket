import {
  Button,
  SelectControl,
  TextControl,
  Flex,
  FlexBlock,
  FlexItem,
} from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import type { Trigger, PostTypeOption } from "../types";

const OPTION_PRESETS = [
  { value: "blogname", label: __("Site Name (blogname)", "wordsocket") },
  {
    value: "blogdescription",
    label: __("Site Description (blogdescription)", "wordsocket"),
  },
];

function autoEvent(trigger: Trigger): string {
  if (trigger.type === "post_type" && trigger.post_type) {
    return trigger.post_type + ".updated";
  }
  if (trigger.type === "option" && trigger.option_name) {
    return "option." + trigger.option_name + ".updated";
  }
  return "";
}

interface Props {
  trigger: Trigger;
  index: number;
  postTypes: PostTypeOption[];
  onChange: (index: number, updated: Trigger) => void;
  onRemove: (index: number) => void;
}

export function TriggerRow({
  trigger,
  index,
  postTypes,
  onChange,
  onRemove,
}: Props) {
  const update = (field: keyof Trigger, value: string): void => {
    const next = { ...trigger, [field]: value };

    if (field === "type" || field === "post_type" || field === "option_name") {
      const currentAuto = autoEvent(trigger);
      if (!trigger.event || trigger.event === currentAuto) {
        next.event = autoEvent(next);
      }
    }

    onChange(index, next);
  };

  const typeOptions = [
    { value: "post_type", label: __("Post Type", "wordsocket") },
    { value: "option", label: __("Option", "wordsocket") },
  ];

  return (
    <Flex gap={5} align="flex-end" justify="space-between" className="wpsignal-trigger-row">
      <FlexItem>
        <Button
          icon="trash"
          label={__("Remove trigger", "wordsocket")}
          isDestructive
          onClick={() => onRemove(index)}
          __next40pxDefaultSize
        />
      </FlexItem>
      <FlexBlock>
        <SelectControl
          className="wpsignal-settings-select"
          label={__("Type", "wordsocket")}
          value={trigger.type}
          options={typeOptions}
          onChange={(val) => update("type", val)}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
        />
      </FlexBlock>

      <FlexBlock>
        {trigger.type === "post_type" && (
          <SelectControl
            className="wpsignal-settings-select"
            label={__("Post Type", "wordsocket")}
            value={trigger.post_type}
            options={[
              { value: "", label: __("-- Select --", "wordsocket") },
              ...postTypes,
            ]}
            onChange={(val) => update("post_type", val)}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
          />
        )}

        {trigger.type === "option" && (
          <SelectControl
            className="wpsignal-settings-select"
            label={__("Option Name", "wordsocket")}
            value={trigger.option_name}
            options={[
              { value: "", label: __("-- Select --", "wordsocket") },
              ...OPTION_PRESETS,
            ]}
            onChange={(val) => update("option_name", val || "")}
            __nextHasNoMarginBottom
            __next40pxDefaultSize
          />
        )}
      </FlexBlock>

      <FlexBlock>
        <TextControl
          label={__("Channel", "wordsocket")}
          value={trigger.channel}
          onChange={(val) => update("channel", val)}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
        />
      </FlexBlock>

      <FlexBlock>
        <TextControl
          label={__("Event", "wordsocket")}
          value={trigger.event}
          onChange={(val) => update("event", val)}
          __nextHasNoMarginBottom
          __next40pxDefaultSize
        />
      </FlexBlock>
    </Flex>
  );
}

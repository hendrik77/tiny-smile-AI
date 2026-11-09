import { Action, ActionPanel, Icon, List, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import type { RouteChoice, RouteOverride } from "./lib/types";

export function overrideId(override: RouteOverride | null): string | null {
  if (!override) return null;
  return override.kind === "api"
    ? `api:${override.connection}:${override.model}`
    : `cli:${override.tool}:${override.model}`;
}

/** Groups choices by connection/tool, keeping the order they came in. */
export function groupChoices(choices: RouteChoice[]): { source: string; choices: RouteChoice[] }[] {
  const groups: { source: string; choices: RouteChoice[] }[] = [];
  for (const choice of choices) {
    const group = groups.find((g) => g.source === choice.source);
    if (group) group.choices.push(choice);
    else groups.push({ source: choice.source, choices: [choice] });
  }
  return groups;
}

export function ModelPicker(props: {
  loadChoices: () => Promise<RouteChoice[]>;
  current: RouteOverride | null;
  onChoose: (override: RouteOverride | null) => void;
}) {
  const { pop } = useNavigation();
  const [choices, setChoices] = useState<RouteChoice[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    props
      .loadChoices()
      .then(setChoices)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const currentId = overrideId(props.current);
  const defaultChoice = choices.find((c) => c.isDefault);

  function choose(override: RouteOverride | null) {
    props.onChoose(override);
    pop();
  }

  return (
    <List isLoading={loading} navigationTitle="Choose AI Model" searchBarPlaceholder="Filter models…">
      {error ? (
        <List.EmptyView icon={Icon.Warning} title="Couldn't read Tinycast's AI settings" description={error} />
      ) : null}
      <List.Section title="Default">
        <List.Item
          id="tinycast-default"
          icon={Icon.Stars}
          title="Tinycast Default"
          subtitle={
            defaultChoice ? `${defaultChoice.source} · ${defaultChoice.model || "Default model"}` : "Settings → AI"
          }
          accessories={currentId === null ? [{ icon: Icon.Checkmark, tooltip: "In use" }] : []}
          actions={
            <ActionPanel>
              <Action title="Use Tinycast Default" icon={Icon.Checkmark} onAction={() => choose(null)} />
            </ActionPanel>
          }
        />
      </List.Section>
      {groupChoices(choices).map((group) => (
        <List.Section key={group.source} title={group.source}>
          {group.choices.map((choice) => (
            <List.Item
              key={choice.id}
              id={choice.id}
              icon={choice.override.kind === "cli" ? Icon.Terminal : Icon.Globe}
              title={choice.model === "" ? "Default model" : choice.model}
              keywords={[group.source]}
              accessories={[
                ...(choice.isDefault ? [{ tag: "Tinycast default" }] : []),
                ...(currentId === choice.id ? [{ icon: Icon.Checkmark, tooltip: "In use" }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action title="Use for Emoji Search" icon={Icon.Checkmark} onAction={() => choose(choice.override)} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

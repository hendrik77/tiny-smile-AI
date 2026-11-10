import { Action, ActionPanel, Icon, Keyboard } from "@raycast/api";
import React from "react";
import { formatEmoji, formatSequence, shortcodeFor, type InsertFormat } from "../lib/insert-format";
import { applySkinTone } from "../lib/skin-tone";
import type { EmojiEntry, SkinTone } from "../lib/types";
import type { TrayState } from "./hooks";

/** What every action panel needs to know; built once per render by the grid. */
export interface ActionContext {
  format: InsertFormat;
  skinTone: SkinTone;
  pasteFirst: boolean;
  tray: TrayState;
  /** Records emojis as used (recents and usage). */
  onUse: (entries: EmojiEntry[]) => void;
  chooseModel: React.ReactNode;
  onClearRecents?: () => void;
  /** Asks the AI again for the shown query; set only while there is a query. */
  refresh?: () => void;
  /** Leaves a chosen remembered search; set only while one is the initial query. */
  back?: () => void;
}

/** Actions on the remembered searches of the empty screen. */
export interface SearchMemoryActions {
  show: (display: string) => void;
  forget: (query: string) => void;
  clear: () => void;
}

const noun = (format: InsertFormat) => (format === "emoji" ? "Emoji" : "Shortcode");

const ADD_SHORTCUT: Keyboard.Shortcut = { modifiers: ["opt"], key: "return" };

function pasteCopy(
  ctx: ActionContext,
  what: string,
  content: string,
  entries: EmojiEntry[],
  onDone?: () => void,
): React.ReactNode[] {
  const used = () => {
    ctx.onUse(entries);
    onDone?.();
  };
  const paste = <Action.Paste key="paste" title={`Paste ${what}`} content={content} onPaste={used} />;
  const copy = <Action.CopyToClipboard key="copy" title={`Copy ${what}`} content={content} onCopy={used} />;
  return ctx.pasteFirst ? [paste, copy] : [copy, paste];
}

/** The "Add to Selection" action: stays open and shows no toast, except when the tray is full. */
function addToSelection(ctx: ActionContext, entries: EmojiEntry[], showFull: () => void): React.ReactNode {
  return (
    <Action
      key="add"
      title="Add to Selection"
      icon={Icon.Plus}
      shortcut={ADD_SHORTCUT}
      onAction={() => {
        if (!ctx.tray.add(entries.map((e) => e.emoji))) showFull();
      }}
    />
  );
}

/** Paste / copy / edit the multi-pick selection; empty while nothing is selected. */
function selectionActions(ctx: ActionContext, extra?: React.ReactNode): React.ReactNode {
  const { tray } = ctx;
  if (tray.entries.length === 0) return null;
  const content = formatSequence(tray.entries, ctx.format, ctx.skinTone);
  const onDone = () => tray.clear();
  const [first, second] = pasteCopy(ctx, "Selection", content, tray.entries, onDone);
  return (
    <ActionPanel.Section key="selection">
      {first}
      {second}
      {extra}
      <Action
        title="Remove Last from Selection"
        icon={Icon.Minus}
        shortcut={{ modifiers: ["cmd"], key: "backspace" }}
        onAction={tray.removeLast}
      />
      <Action title="Clear Selection" icon={Icon.XMarkCircle} onAction={tray.clear} />
    </ActionPanel.Section>
  );
}

/** Refresh Suggestions and Back to Start, whichever apply; empty otherwise. */
function queryActions(ctx: ActionContext): React.ReactNode {
  if (!ctx.refresh && !ctx.back) return null;
  return (
    <ActionPanel.Section key="query">
      {ctx.refresh ? (
        <Action
          title="Refresh Suggestions"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={ctx.refresh}
        />
      ) : null}
      {ctx.back ? <Action title="Back to Start" icon={Icon.ArrowLeft} onAction={ctx.back} /> : null}
    </ActionPanel.Section>
  );
}

/** The ActionPanel of a remembered-search tile: show it, forget it, clear the memory. */
export function SearchActions(props: {
  query: string;
  display: string;
  ctx: ActionContext;
  searches: SearchMemoryActions;
}) {
  const { query, display, ctx, searches } = props;
  return (
    <ActionPanel title={`Search · ${display}`}>
      <ActionPanel.Section>
        <Action title="Show Results" icon={Icon.MagnifyingGlass} onAction={() => searches.show(display)} />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action
          title="Forget This Search"
          icon={Icon.Trash}
          shortcut={{ modifiers: ["ctrl"], key: "x" }}
          onAction={() => searches.forget(query)}
        />
        <Action
          title="Clear Search Memory"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          onAction={searches.clear}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>{ctx.chooseModel}</ActionPanel.Section>
    </ActionPanel>
  );
}

/** The ActionPanel of the empty view: only the selection (when there is one) and the model actions. */
export function EmptyActions(props: { ctx: ActionContext }) {
  const { ctx } = props;
  return (
    <ActionPanel>
      {selectionActions(ctx)}
      {queryActions(ctx)}
      <ActionPanel.Section>{ctx.chooseModel}</ActionPanel.Section>
    </ActionPanel>
  );
}

export function EmojiActions(props: { entry: EmojiEntry; ctx: ActionContext; onTrayFull: () => void }) {
  const { entry, ctx, onTrayFull } = props;
  const { format, skinTone } = ctx;
  const emoji = applySkinTone(entry, skinTone);
  const content = formatEmoji(entry, format, skinTone);
  const add = addToSelection(ctx, [entry], onTrayFull);
  const secondary =
    format === "emoji" ? (
      <Action.CopyToClipboard
        key="secondary"
        title="Copy Shortcode"
        content={`:${shortcodeFor(entry, "github") ?? shortcodeFor(entry, "slack") ?? entry.slug}:`}
        shortcut={{ modifiers: ["cmd", "opt"], key: "s" }}
      />
    ) : (
      <Action.CopyToClipboard
        key="secondary"
        title="Copy Emoji"
        content={emoji}
        shortcut={{ modifiers: ["cmd", "opt"], key: "s" }}
      />
    );
  const hasSelection = ctx.tray.entries.length > 0;
  return (
    <ActionPanel title={entry.name}>
      {selectionActions(ctx, add)}
      <ActionPanel.Section>
        {pasteCopy(ctx, noun(format), content, [entry])}
        {hasSelection ? null : add}
      </ActionPanel.Section>
      {queryActions(ctx)}
      <ActionPanel.Section>{ctx.chooseModel}</ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard title="Copy Name" content={entry.name} shortcut={Keyboard.Shortcut.Common.CopyName} />
        {secondary}
        {ctx.onClearRecents ? (
          <Action
            title="Clear Recently Used"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={ctx.onClearRecents}
          />
        ) : null}
      </ActionPanel.Section>
    </ActionPanel>
  );
}

export function ComboActions(props: {
  combo: EmojiEntry[];
  title: string;
  ctx: ActionContext;
  onTrayFull: () => void;
}) {
  const { combo, title, ctx, onTrayFull } = props;
  const content = formatSequence(combo, ctx.format, ctx.skinTone);
  const add = addToSelection(ctx, combo, onTrayFull);
  const hasSelection = ctx.tray.entries.length > 0;
  return (
    <ActionPanel title={title}>
      {selectionActions(ctx, add)}
      <ActionPanel.Section>
        {pasteCopy(ctx, "Combination", content, combo)}
        {hasSelection ? null : add}
      </ActionPanel.Section>
      {queryActions(ctx)}
      <ActionPanel.Section>{ctx.chooseModel}</ActionPanel.Section>
    </ActionPanel>
  );
}

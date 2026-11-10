/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Tinycast Channel - Which Tinycast install to read the AI settings from. */
  "channel": "com.tinycast.app" | "com.tinycast.app.beta" | "com.tinycast.app.dev",
  /** AI Suggestions - How many emojis to ask the AI for. */
  "resultCount": "12" | "24" | "36" | "48",
  /** Speed - Ask thinking models to reason as little as possible, using the lowest level declared for the model in Tinycast. */
  "minimizeThinking": boolean,
  /** Primary Action - What Enter does with the selected emoji. */
  "primaryAction": "paste" | "copy",
  /** Skin Tone - Skin tone applied to emojis that support one. */
  "skinTone": "none" | "light" | "medium-light" | "medium" | "medium-dark" | "dark",
  /** Name Search Language - Extra language for the instant name matches. English is always searched. */
  "language": "system" | "en" | "de",
  /** Selected Text - The selection of the frontmost app is used as the first search and sent to the AI like typed text. Nothing is read when you give the command an argument. */
  "useSelection": boolean,
  /** Insert As - What Paste and Copy insert: the emoji itself or a shortcode for apps that expect one. */
  "pasteFormat": "emoji" | "github" | "slack",
  /** Combinations - Ask the AI for a few short emoji sequences in addition to single emojis. */
  "combos": boolean,
  /** Built-in Answers - Use prepared emojis for frequent searches such as thanks or birthday. The AI can still be asked with Refresh Suggestions. */
  "builtin": boolean,
  /** Search Memory - Keep your searches and their answers on this Mac, show them on the empty screen and answer them instantly. */
  "searchMemory": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `ai-emoji-search` command */
  export type AiEmojiSearch = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `ai-emoji-search` command */
  export type AiEmojiSearch = {
  /** Mood or situation */
  "query": string
}
}


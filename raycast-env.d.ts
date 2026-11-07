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
  "primaryAction": "paste" | "copy"
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `ai-emoji-search` command */
  export type AiEmojiSearch = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `ai-emoji-search` command */
  export type AiEmojiSearch = {}
}


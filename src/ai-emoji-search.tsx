import type { LaunchProps } from "@raycast/api";
import { EmojiGrid } from "./emoji-grid";

export default function Command(props: LaunchProps<{ arguments: Arguments.AiEmojiSearch }>) {
  return <EmojiGrid argumentQuery={props?.arguments?.query} />;
}

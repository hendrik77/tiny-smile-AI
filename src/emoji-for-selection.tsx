import { Grid, Toast, getSelectedText, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { EmojiGrid } from "./emoji-grid";

export default function Command() {
  const [state, setState] = useState<{ pending: boolean; text?: string }>({ pending: true });

  useEffect(() => {
    let cancelled = false;
    getSelectedText()
      .then((text) => {
        if (cancelled) return;
        if (text.trim()) setState({ pending: false, text });
        else throw new Error("blank");
      })
      .catch(() => {
        if (cancelled) return;
        setState({ pending: false });
        showToast({
          style: Toast.Style.Failure,
          title: "No text selected",
          message: "Select some text first, or type what you want to express.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.pending) return <Grid isLoading />;
  return <EmojiGrid initialQuery={state.text} />;
}

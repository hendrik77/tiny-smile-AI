/** Minimal dependency-free XML plist parser (enough for `defaults export`). */

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code > 0x10ffff) throw new Error(`Invalid plist: bad character reference ${m}`);
      return String.fromCodePoint(code);
    }
    if (e in NAMED) return NAMED[e];
    throw new Error(`Invalid plist: unknown entity ${m}`);
  });
}

type Token =
  | { t: "open"; name: string; selfClosing: boolean }
  | { t: "close"; name: string }
  | { t: "text"; text: string };

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml[i] !== "<") {
      const end = xml.indexOf("<", i);
      const stop = end === -1 ? xml.length : end;
      tokens.push({ t: "text", text: xml.slice(i, stop) });
      i = stop;
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end === -1) throw new Error("Invalid plist: unterminated comment");
      i = end + 3;
    } else if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end === -1) throw new Error("Invalid plist: unterminated processing instruction");
      i = end + 2;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end === -1) throw new Error("Invalid plist: unterminated CDATA");
      // Re-encode so the later entity decoding leaves it intact.
      const raw = xml.slice(i + 9, end);
      tokens.push({ t: "text", text: raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") });
      i = end + 3;
    } else if (xml.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset [...]
      let depth = 0;
      let j = i + 2;
      for (; j < xml.length; j++) {
        const c = xml[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (j >= xml.length) throw new Error("Invalid plist: unterminated declaration");
      i = j + 1;
    } else {
      const end = xml.indexOf(">", i);
      if (end === -1) throw new Error("Invalid plist: unterminated tag");
      const inner = xml.slice(i + 1, end);
      if (inner[0] === "/") {
        const name = inner.slice(1).trim();
        if (!/^[A-Za-z][\w-]*$/.test(name)) throw new Error(`Invalid plist: bad closing tag </${name}>`);
        tokens.push({ t: "close", name });
      } else {
        const m = /^([A-Za-z][\w-]*)(\s[^>]*?)?(\/?)$/.exec(inner.trim());
        if (!m) throw new Error(`Invalid plist: bad tag <${inner}>`);
        tokens.push({ t: "open", name: m[1], selfClosing: m[3] === "/" });
      }
      i = end + 1;
    }
  }
  return tokens;
}

export function parsePlistXML(xml: string): unknown {
  const tokens = tokenize(xml);
  let pos = 0;

  const skipWs = () => {
    while (pos < tokens.length) {
      const k = tokens[pos];
      if (k.t === "text" && k.text.trim() === "") pos++;
      else break;
    }
  };

  const readText = (name: string): string => {
    let text = "";
    while (pos < tokens.length && tokens[pos].t === "text") text += (tokens[pos++] as { text: string }).text;
    const k = tokens[pos++];
    if (!k || k.t !== "close" || k.name !== name) throw new Error(`Invalid plist: expected </${name}>`);
    return text;
  };

  const expectClose = (name: string) => {
    skipWs();
    const k = tokens[pos++];
    if (!k || k.t !== "close" || k.name !== name) throw new Error(`Invalid plist: expected </${name}>`);
  };

  const parseValue = (): unknown => {
    skipWs();
    const tok = tokens[pos++];
    if (!tok) throw new Error("Invalid plist: unexpected end of input");
    if (tok.t !== "open") throw new Error("Invalid plist: expected a value element");
    const { name, selfClosing } = tok;
    switch (name) {
      case "true":
      case "false":
        if (!selfClosing) expectClose(name);
        return name === "true";
      case "dict": {
        const obj: Record<string, unknown> = {};
        if (selfClosing) return obj;
        for (;;) {
          skipWs();
          const k = tokens[pos];
          if (!k) throw new Error("Invalid plist: unterminated <dict>");
          if (k.t === "close") {
            if (k.name !== "dict") throw new Error("Invalid plist: mismatched </" + k.name + "> in <dict>");
            pos++;
            return obj;
          }
          if (k.t !== "open" || k.name !== "key") throw new Error("Invalid plist: expected <key> in <dict>");
          pos++;
          const key = k.selfClosing ? "" : decodeEntities(readText("key"));
          obj[key] = parseValue();
        }
      }
      case "array": {
        const arr: unknown[] = [];
        if (selfClosing) return arr;
        for (;;) {
          skipWs();
          const k = tokens[pos];
          if (!k) throw new Error("Invalid plist: unterminated <array>");
          if (k.t === "close") {
            if (k.name !== "array") throw new Error("Invalid plist: mismatched </" + k.name + "> in <array>");
            pos++;
            return arr;
          }
          arr.push(parseValue());
        }
      }
      case "string":
      case "date":
        return selfClosing ? "" : decodeEntities(readText(name));
      case "integer":
      case "real": {
        const raw = selfClosing ? "" : readText(name).trim();
        const n = Number(raw);
        if (raw === "" || Number.isNaN(n)) throw new Error(`Invalid plist: bad <${name}> value "${raw}"`);
        return n;
      }
      case "data": {
        const raw = selfClosing ? "" : readText("data").replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error("Invalid plist: bad base64 in <data>");
        return new Uint8Array(Buffer.from(raw, "base64"));
      }
      default:
        throw new Error(`Invalid plist: unsupported element <${name}>`);
    }
  };

  skipWs();
  const first = tokens[pos];
  if (!first) throw new Error("Invalid plist: empty input");
  let wrapped = false;
  if (first.t === "open" && first.name === "plist") {
    pos++;
    wrapped = true;
  }
  const value = parseValue();
  if (wrapped) expectClose("plist");
  skipWs();
  if (pos < tokens.length) throw new Error("Invalid plist: trailing content");
  return value;
}

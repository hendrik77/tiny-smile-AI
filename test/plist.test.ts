import { describe, it, expect } from "vitest";
import { parsePlistXML } from "../src/lib/plist";

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${body}\n</plist>`;

describe("parsePlistXML", () => {
  it("parses a realistic defaults export", () => {
    const json = '[{"id":"A"}]';
    const b64 = Buffer.from(json).toString("base64");
    const xml = wrap(`<dict>
	<key>aiConnections</key>
	<data>
	${b64.slice(0, 8)}
	${b64.slice(8)}
	</data>
	<key>aiDisabledRoutes</key>
	<array>
		<string>api:X</string>
		<string>claude</string>
	</array>
	<key>count</key>
	<integer>42</integer>
	<key>ratio</key>
	<real>1.5</real>
	<key>on</key>
	<true/>
	<key>off</key>
	<false/>
	<key>when</key>
	<date>2025-01-01T00:00:00Z</date>
</dict>`);
    const r = parsePlistXML(xml) as Record<string, unknown>;
    expect(Buffer.from(r.aiConnections as Uint8Array).toString("utf8")).toBe(json);
    expect(r.aiDisabledRoutes).toEqual(["api:X", "claude"]);
    expect(r.count).toBe(42);
    expect(r.ratio).toBe(1.5);
    expect(r.on).toBe(true);
    expect(r.off).toBe(false);
    expect(r.when).toBe("2025-01-01T00:00:00Z");
  });
  it("handles self-closing containers and strings", () => {
    expect(parsePlistXML(wrap("<dict><key>a</key><dict/><key>b</key><array/><key>c</key><string/></dict>"))).toEqual({
      a: {},
      b: [],
      c: "",
    });
  });
  it("decodes entities", () => {
    expect(
      parsePlistXML(wrap("<array><string>&lt;a&gt; &amp; &quot;q&quot; &apos;s&apos; &#65;&#x42;</string></array>")),
    ).toEqual([`<a> & "q" 's' AB`]);
  });
  it("skips comments and nested structures", () => {
    expect(
      parsePlistXML(
        wrap("<!-- hi --><dict><key>k</key><array><dict><key>z</key><integer>-1</integer></dict></array></dict>"),
      ),
    ).toEqual({
      k: [{ z: -1 }],
    });
  });
  it("works without prolog", () => {
    expect(parsePlistXML("<plist><string>x</string></plist>")).toBe("x");
  });
  it("throws on malformed input", () => {
    expect(() => parsePlistXML("")).toThrow();
    expect(() => parsePlistXML(wrap("<dict><key>a</key>"))).toThrow();
    expect(() => parsePlistXML(wrap("<dict><key>a</key></dict"))).toThrow();
    expect(() => parsePlistXML(wrap("<dict><string>a</string></dict>"))).toThrow();
    expect(() => parsePlistXML(wrap("<dict><key>a</key></dict>"))).toThrow();
    expect(() => parsePlistXML(wrap("<bogus/>"))).toThrow();
    expect(() => parsePlistXML(wrap("<array><string>a</array>"))).toThrow();
  });
});

import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { isOpenableLink, Link } from "./Markdown";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn<(url: string) => Promise<void>>() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

/** The part of a mouse event the link reads. */
interface FakeMouseEvent {
  button: number;
  preventDefault: () => void;
}
type Handler = (event: FakeMouseEvent) => void;

/** The props the link puts on its anchor, which is all the browser sees of it. */
function anchorProps(href: string | undefined) {
  const element = Link({ href, children: "site" });
  if (!isValidElement<{ onClick: Handler; onAuxClick: Handler }>(element)) throw new Error("not an element");
  return element.props;
}

function click(handler: Handler, button: number) {
  const preventDefault = vi.fn();
  handler({ button, preventDefault });
  return preventDefault;
}

describe("links in a reply", () => {
  it("opens only web addresses", () => {
    expect(isOpenableLink("https://example.com/a")).toBe(true);
    expect(isOpenableLink("HTTP://example.com")).toBe(true);
    expect(isOpenableLink("javascript:alert(1)")).toBe(false);
    expect(isOpenableLink("/relative")).toBe(false);
    expect(isOpenableLink(undefined)).toBe(false);
  });

  it("hands a click to the system browser and keeps the webview where it is", () => {
    openUrl.mockReset().mockResolvedValue(undefined);
    const props = anchorProps("https://example.com/a");
    expect(click(props.onClick, 0)).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("does not let a middle click open a window of the webview's own", () => {
    openUrl.mockReset().mockResolvedValue(undefined);
    const props = anchorProps("https://example.com/a");
    expect(click(props.onAuxClick, 1)).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledOnce();
    // A right click is the context menu's business; it must still not navigate.
    expect(click(props.onAuxClick, 2)).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledOnce();
  });

  it("opens nothing for a link that is not a web address", () => {
    openUrl.mockReset().mockResolvedValue(undefined);
    const props = anchorProps("javascript:alert(1)");
    click(props.onClick, 0);
    click(props.onAuxClick, 1);
    expect(openUrl).not.toHaveBeenCalled();
  });
});

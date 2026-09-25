// @vitest-environment jsdom
/**
 * Tooltip: a click hides it until the pointer leaves (it would otherwise sit on top of what the
 * click revealed — e.g. the merge card under the cable switch), and it is nudged back inside a
 * narrow viewport.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../Tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <Tooltip content="Online — unplug this tab">
        <button type="button">cable</button>
      </Tooltip>,
    );
  });
  const button = host.querySelector("button")!;
  const tip = host.querySelector<HTMLElement>('[role="tooltip"]')!;
  return { wrapper: button.parentElement!, button, tip };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe("Tooltip", () => {
  it("hides after a click until the pointer leaves", async () => {
    const { wrapper, button, tip } = await mount();
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.classList.contains("hidden")).toBe(false);
    await act(async () => fire(button, "pointerdown"));
    expect(tip.classList.contains("hidden")).toBe(true);
    await act(async () => fire(wrapper, "pointerout")); // React's pointerleave is built on pointerout
    expect(tip.classList.contains("hidden")).toBe(false);
  });

  it("is shifted back inside the viewport when it would overflow", async () => {
    const { wrapper, tip } = await mount();
    Object.defineProperty(document.documentElement, "clientWidth", { value: 360, configurable: true });
    tip.getBoundingClientRect = () => ({ left: 200, right: 520, width: 320, top: 0, bottom: 40, height: 40, x: 200, y: 0, toJSON: () => ({}) });
    await act(async () => fire(wrapper, "pointerover")); // → onPointerEnter
    expect(tip.style.marginLeft).toBe(`${360 - 8 - 520}px`);
  });
});

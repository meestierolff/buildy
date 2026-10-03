import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaLightbox from "@/components/MediaLightbox";

vi.mock("@/components/moderation/ReportDialog", () => ({ default: () => null }));

const items = [0, 1, 2].map((id) => ({
  id: String(id), url: `/api/media/${id}`, type: "image", updateId: "moment",
  updateTitle: "De nieuwe keuken", updateDate: "2026-10-03",
}));

afterEach(cleanup);

function setup() {
  const onClose = vi.fn();
  const onIndex = vi.fn();
  render(<MediaLightbox items={items} index={1} onClose={onClose} onIndex={onIndex} />);
  const photo = screen.getByRole("img");
  return { onClose, onIndex, photo };
}

function swipe(photo: HTMLElement, x: number, y: number) {
  fireEvent.touchStart(photo, { touches: [{ clientX: 200, clientY: 250 }] });
  fireEvent.touchMove(photo, { touches: [{ clientX: x, clientY: y }] });
  fireEvent.touchEnd(photo, { touches: [], changedTouches: [{ clientX: x, clientY: y }] });
}

describe("Bouwmoment media swipes", () => {
  it.each([100, 400])("closes with a deliberate vertical swipe to y=%s", (y) => {
    const { photo, onClose, onIndex } = setup();
    swipe(photo, 215, y);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onIndex).not.toHaveBeenCalled();
  });

  it.each([[90, 2], [310, 0]])("keeps horizontal photo navigation at x=%s", (x, next) => {
    const { photo, onClose, onIndex } = setup();
    swipe(photo, x, 260);
    expect(onIndex).toHaveBeenCalledWith(next);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([[210, 270], [300, 350]])("ignores short or ambiguous diagonal gestures", (x, y) => {
    const { photo, onClose, onIndex } = setup();
    swipe(photo, x, y);
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("does not treat a cancelled gesture or pinch as a dismissal", () => {
    const { photo, onClose, onIndex } = setup();
    fireEvent.touchStart(photo, { touches: [{ clientX: 200, clientY: 250 }] });
    fireEvent.touchCancel(photo);
    fireEvent.touchEnd(photo, { touches: [], changedTouches: [{ clientX: 200, clientY: 450 }] });
    fireEvent.touchStart(photo, { touches: [{ clientX: 200, clientY: 250 }] });
    fireEvent.touchMove(photo, { touches: [{ clientX: 180, clientY: 200 }, { clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(photo, { touches: [], changedTouches: [{ clientX: 200, clientY: 450 }] });
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndex).not.toHaveBeenCalled();
  });
});

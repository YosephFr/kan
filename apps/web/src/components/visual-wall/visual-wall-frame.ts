export function createVisualWallFrame<T>(
  render: (value: T) => void,
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  return {
    schedule(value: T) {
      pending = { value };
      if (frame !== null) return;
      frame = request(() => {
        frame = null;
        const next = pending;
        pending = null;
        if (next) render(next.value);
      });
    },
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}

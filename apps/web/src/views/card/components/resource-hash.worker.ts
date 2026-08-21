const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<ArrayBuffer>) => void,
  ) => void;
  postMessage: (message: { sha256?: string; error?: string }) => void;
};

workerScope.addEventListener("message", (event) => {
  void crypto.subtle
    .digest("SHA-256", event.data)
    .then((digest) => {
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      workerScope.postMessage({ sha256 });
    })
    .catch(() => workerScope.postMessage({ error: "hash" }));
});

export {};

import { describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import {
  CardCanvasClipboardLimitError,
  getCardCanvasClipboardInputFromDataTransfer,
  isCardCanvasInternalClipboard,
  MAX_CARD_CANVAS_CLIPBOARD_BYTES,
  normalizeCardCanvasClipboard,
  readCardCanvasClipboardItems,
} from "./card-canvas-clipboard";

const makeImage = (name = "idea.png", type = "image/png") =>
  new File(["image"], name, { type, lastModified: 1 });

const makeSizedImage = (size: number, name = "idea.png") =>
  new File([new Uint8Array(size)], name, {
    type: "image/png",
    lastModified: 1,
  });

const expectLimit = (
  run: () => unknown,
  code: CardCanvasClipboardLimitError["code"],
) => {
  try {
    run();
    throw new Error("Expected clipboard limit error");
  } catch (error) {
    expect(error).toBeInstanceOf(CardCanvasClipboardLimitError);
    expect((error as CardCanvasClipboardLimitError).code).toBe(code);
  }
};

describe("card canvas clipboard normalization", () => {
  it("keeps clean multiline text editable", () => {
    const result = normalizeCardCanvasClipboard({
      text: "  Primera idea\r\n\r\n  Segunda   idea\t  \n",
    });

    expect(result).toEqual({
      items: [{ type: "text", text: "Primera idea\n\nSegunda idea" }],
      counts: { objects: 1, images: 0, links: 0 },
    });
  });

  it("turns only a pure HTTPS value into a link", () => {
    expect(
      normalizeCardCanvasClipboard({
        text: " https://example.com/ideas?q=1 ",
      }).items,
    ).toEqual([{ type: "link", url: "https://example.com/ideas?q=1" }]);
    expect(
      normalizeCardCanvasClipboard({ text: "http://example.com/ideas" }).items,
    ).toEqual([{ type: "text", text: "http://example.com/ideas" }]);
  });

  it("extracts ordered text, links and images without rendering HTML", () => {
    const result = normalizeCardCanvasClipboard({
      html: [
        "<section><p>Primera &amp; segunda<br>línea</p>",
        '<a href="https://example.com/doc">Documento</a>',
        '<img src="https://cdn.example.com/mapa.png" alt="Mapa mental">',
        "<div>Última idea</div></section>",
      ].join(""),
      text: "representación alternativa que no debe duplicarse",
    });

    expect(result.items).toEqual([
      { type: "text", text: "Primera & segunda\nlínea" },
      {
        type: "link",
        url: "https://example.com/doc",
        label: "Documento",
      },
      {
        type: "image",
        source: "url",
        url: "https://cdn.example.com/mapa.png",
        altText: "Mapa mental",
      },
      { type: "text", text: "Última idea" },
    ]);
  });

  it("drops executable and hidden HTML while retaining visible unsafe-link labels", () => {
    const result = normalizeCardCanvasClipboard({
      html: [
        "<style>private-style</style><script>private-script</script>",
        '<iframe src="https://private.example"></iframe>',
        '<p><a href="javascript:alert(1)">Texto visible</a></p>',
        '<img src="http://example.com/unsafe.png" alt="unsafe">',
        '<a href="https://user:secret@example.com/private">Etiqueta segura</a>',
      ].join(""),
    });

    expect(result.items).toEqual([
      { type: "text", text: "Texto visible\nEtiqueta segura" },
    ]);
  });

  it("drops hidden subtrees, including nested content after matching child tags", () => {
    const result = normalizeCardCanvasClipboard({
      html: [
        '<div hidden><div>Oculto anidado</div><a href="https://tracker.example/hidden">Enlace oculto</a></div>',
        '<section aria-hidden="TRUE"><img src="https://tracker.example/aria.png"></section>',
        '<aside style="display: none !important"><span>No visible</span></aside>',
        '<nav style="visibility:hidden"><a href="https://tracker.example/nav">Nav oculto</a></nav>',
        '<p><a href="https://example.com/visible">Visible</a></p>',
      ].join(""),
    });

    expect(result.items).toEqual([
      {
        type: "link",
        url: "https://example.com/visible",
        label: "Visible",
      },
    ]);
  });

  it("never restores hidden HTML from its plain-text representation", () => {
    expect(
      normalizeCardCanvasClipboard({
        html: "<div hidden>PRIVATE_MARKER</div>",
        text: "PRIVATE_MARKER",
      }).items,
    ).toEqual([]);
  });

  it("drops declared 1x1 tracking images but keeps visible images", () => {
    const result = normalizeCardCanvasClipboard({
      html: [
        '<img width="1" height="1" src="https://tracker.example/attribute.gif">',
        '<img style="width: 1px; height: 1px" src="https://tracker.example/style.png">',
        '<img width="2" height="1" src="https://cdn.example.com/divider.png">',
      ].join(""),
    });

    expect(result.items).toEqual([
      {
        type: "image",
        source: "url",
        url: "https://cdn.example.com/divider.png",
      },
    ]);
  });

  it("deduplicates repeated hrefs, image URLs and URI-list entries", () => {
    expect(
      normalizeCardCanvasClipboard({
        html: [
          '<a href="https://example.com/a">A</a>',
          '<a href="https://example.com/a">A duplicado</a>',
          '<img src="https://example.com/a.png">',
          '<img src="https://example.com/a.png">',
        ].join(""),
      }).items,
    ).toEqual([
      { type: "link", url: "https://example.com/a", label: "A" },
      { type: "text", text: "A duplicado" },
      {
        type: "image",
        source: "url",
        url: "https://example.com/a.png",
      },
    ]);
    expect(
      normalizeCardCanvasClipboard({
        uriList:
          "# copied URLs\nhttps://example.com/a\nhttp://example.com/b\nhttps://example.com/a",
      }).items,
    ).toEqual([{ type: "link", url: "https://example.com/a" }]);
  });

  it("replaces an HTML image representation with its binary clipboard file", () => {
    const file = makeImage();

    expect(
      normalizeCardCanvasClipboard({
        html: '<p>Antes</p><img src="https://cdn.example.com/idea.png"><p>Después</p>',
        images: [{ file, sourceUrl: "https://cdn.example.com/idea.png" }],
      }).items,
    ).toEqual([
      { type: "text", text: "Antes" },
      {
        type: "image",
        source: "file",
        file,
        sourceUrl: "https://cdn.example.com/idea.png",
      },
      { type: "text", text: "Después" },
    ]);
  });

  it("deduplicates the single binary and HTML image alternatives without a source hint", () => {
    const file = makeImage();

    expect(
      normalizeCardCanvasClipboard({
        html: '<img src="https://cdn.example.com/idea.png">',
        images: [{ file }],
      }).items,
    ).toEqual([{ type: "image", source: "file", file }]);
  });

  it("drops an ambiguous binary representation when HTML contains several images", () => {
    const flattenedSelection = makeImage("selection.png");

    expect(
      normalizeCardCanvasClipboard({
        html: [
          "<p>Antes</p>",
          '<img src="https://cdn.example.com/one.png">',
          "<p>Entre</p>",
          '<img src="https://cdn.example.com/two.png">',
          "<p>Después</p>",
        ].join(""),
        images: [{ file: flattenedSelection }],
      }).items,
    ).toEqual([
      { type: "text", text: "Antes" },
      {
        type: "image",
        source: "url",
        url: "https://cdn.example.com/one.png",
      },
      { type: "text", text: "Entre" },
      {
        type: "image",
        source: "url",
        url: "https://cdn.example.com/two.png",
      },
      { type: "text", text: "Después" },
    ]);
  });

  it("keeps exact image matches without assigning an extra binary to another HTML image", () => {
    const exact = makeImage("one.png");
    const flattenedSelection = makeImage("selection.png");

    expect(
      normalizeCardCanvasClipboard({
        html: [
          '<img src="https://cdn.example.com/one.png">',
          '<img src="https://cdn.example.com/two.png">',
        ].join(""),
        images: [
          { file: exact, sourceUrl: "https://cdn.example.com/one.png" },
          { file: flattenedSelection },
        ],
      }).items,
    ).toEqual([
      {
        type: "image",
        source: "file",
        file: exact,
        sourceUrl: "https://cdn.example.com/one.png",
      },
      {
        type: "image",
        source: "url",
        url: "https://cdn.example.com/two.png",
      },
    ]);
  });

  it("deduplicates repeated binary file representations", () => {
    const file = makeImage();

    expect(
      normalizeCardCanvasClipboard({
        images: [{ file }, { file }],
      }).items,
    ).toEqual([{ type: "image", source: "file", file }]);
  });

  it("accepts exactly 256 KiB and rejects one byte more", () => {
    const exact = normalizeCardCanvasClipboard({
      text: "a".repeat(MAX_CARD_CANVAS_CLIPBOARD_BYTES),
    }).items[0];
    expect(exact?.type).toBe("text");
    expect(exact?.type === "text" ? exact.text.length : 0).toBe(
      MAX_CARD_CANVAS_CLIPBOARD_BYTES,
    );
    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          text: "a".repeat(MAX_CARD_CANVAS_CLIPBOARD_BYTES + 1),
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );
  });

  it("measures aggregate UTF-8 bytes before parsing HTML", () => {
    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          html: "á".repeat(MAX_CARD_CANVAS_CLIPBOARD_BYTES / 2),
          text: "a",
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );
  });

  it("accepts 20 objects and rejects the twenty-first", () => {
    const twentyObjects = Array.from(
      { length: 10 },
      (_, index) =>
        `idea ${index}<a href="https://example.com/${index}">link ${index}</a>`,
    ).join("");

    expect(
      normalizeCardCanvasClipboard({ html: twentyObjects }).counts,
    ).toEqual({ objects: 20, images: 0, links: 10 });
    expectLimit(
      () => normalizeCardCanvasClipboard({ html: `${twentyObjects}extra` }),
      "CLIPBOARD_OBJECT_LIMIT_REACHED",
    );
  });

  it("accepts 10 links and rejects the eleventh", () => {
    const links = (count: number) =>
      Array.from(
        { length: count },
        (_, index) => `<a href="https://example.com/${index}"></a>`,
      ).join("");

    expect(normalizeCardCanvasClipboard({ html: links(10) }).counts.links).toBe(
      10,
    );
    expectLimit(
      () => normalizeCardCanvasClipboard({ html: links(11) }),
      "CLIPBOARD_LINK_LIMIT_REACHED",
    );
    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          uriList: Array.from(
            { length: 11 },
            (_, index) => `https://example.com/${index}`,
          ).join("\n"),
        }),
      "CLIPBOARD_LINK_LIMIT_REACHED",
    );
  });

  it("accepts 10 images and rejects the eleventh before normalization", () => {
    expect(
      normalizeCardCanvasClipboard({
        images: Array.from({ length: 10 }, (_, index) => ({
          file: makeImage(`idea-${index}.png`),
        })),
      }).counts.images,
    ).toBe(10);
    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          images: Array.from({ length: 11 }, (_, index) => ({
            file: makeImage(`idea-${index}.png`),
          })),
        }),
      "CLIPBOARD_IMAGE_LIMIT_REACHED",
    );
  });

  it("enforces the 10 MiB image and 20 MiB aggregate budgets on direct input", () => {
    expect(
      normalizeCardCanvasClipboard({
        images: [
          { file: makeSizedImage(MAX_CARD_CANVAS_IMAGE_BYTES, "one.png") },
          { file: makeSizedImage(MAX_CARD_CANVAS_IMAGE_BYTES, "two.png") },
        ],
      }).counts.images,
    ).toBe(2);

    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          images: [
            {
              file: makeSizedImage(
                MAX_CARD_CANVAS_IMAGE_BYTES + 1,
                "oversized.png",
              ),
            },
          ],
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );

    expectLimit(
      () =>
        normalizeCardCanvasClipboard({
          images: [
            { file: makeSizedImage(MAX_CARD_CANVAS_IMAGE_BYTES, "one.png") },
            { file: makeSizedImage(MAX_CARD_CANVAS_IMAGE_BYTES, "two.png") },
            { file: makeSizedImage(1, "overflow.png") },
          ],
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );
  });
});

describe("card canvas clipboard adapters", () => {
  it("reads only the preferred browser paste-event text representation", () => {
    const image = makeImage();
    const document = new File(["notes"], "notes.txt", { type: "text/plain" });
    const values: Record<string, string> = {
      "text/plain": "Plain",
      "text/html": "<p>Rich</p>",
      "text/uri-list": "https://example.com",
    };
    const getData = vi.fn((type: string) => values[type] ?? "");

    expect(
      getCardCanvasClipboardInputFromDataTransfer({
        files: [document, image] as unknown as FileList,
        getData,
        types: Object.keys(values),
      }),
    ).toEqual({
      html: "<p>Rich</p>",
      images: [{ file: image }],
      formats: Object.keys(values),
    });
    expect(getData).toHaveBeenCalledTimes(1);
    expect(getData).toHaveBeenCalledWith("text/html");
  });

  it("prefers URI-list over plain text in browser paste events", () => {
    const getData = vi.fn((type: string) =>
      type === "text/uri-list" ? "https://example.com" : "Plain",
    );

    expect(
      getCardCanvasClipboardInputFromDataTransfer({
        files: [] as unknown as FileList,
        getData,
        types: ["text/plain", "text/uri-list"],
      }),
    ).toMatchObject({ uriList: "https://example.com" });
    expect(getData).toHaveBeenCalledTimes(1);
    expect(getData).toHaveBeenCalledWith("text/uri-list");
  });

  it("keeps plain-text Excalidraw copies available to the internal path", () => {
    const text = '{"type":"excalidraw/clipboard","elements":[]}';
    const input = getCardCanvasClipboardInputFromDataTransfer({
      files: [] as unknown as FileList,
      getData: vi.fn(() => text),
      types: ["text/plain"],
    });

    expect(input.text).toBe(text);
    expect(isCardCanvasInternalClipboard(input)).toBe(true);
  });

  it("stops scanning native files as soon as an oversized image batch is known", () => {
    let visited = 0;
    const files = {
      *[Symbol.iterator]() {
        for (let index = 0; index < 100; index += 1) {
          visited += 1;
          yield makeImage(`idea-${index}.png`);
        }
      },
    } as unknown as FileList;

    expectLimit(
      () =>
        getCardCanvasClipboardInputFromDataTransfer({
          files,
          getData: vi.fn(() => ""),
          types: [],
        }),
      "CLIPBOARD_IMAGE_LIMIT_REACHED",
    );
    expect(visited).toBe(11);
  });

  it("checks native image bytes before reading text or the next file", () => {
    const getData = vi.fn(() => "unused");
    let individualVisited = 0;
    const individualFiles = {
      *[Symbol.iterator]() {
        individualVisited += 1;
        yield makeSizedImage(MAX_CARD_CANVAS_IMAGE_BYTES + 1, "large.png");
        individualVisited += 1;
        yield makeImage("unread.png");
      },
    } as unknown as FileList;

    expectLimit(
      () =>
        getCardCanvasClipboardInputFromDataTransfer({
          files: individualFiles,
          getData,
          types: ["text/plain"],
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );
    expect(individualVisited).toBe(1);
    expect(getData).not.toHaveBeenCalled();

    let aggregateVisited = 0;
    const aggregateFiles = {
      *[Symbol.iterator]() {
        for (const [size, name] of [
          [MAX_CARD_CANVAS_IMAGE_BYTES, "one.png"],
          [MAX_CARD_CANVAS_IMAGE_BYTES, "two.png"],
          [1, "overflow.png"],
          [1, "unread.png"],
        ] as const) {
          aggregateVisited += 1;
          yield makeSizedImage(size, name);
        }
      },
    } as unknown as FileList;

    expectLimit(
      () =>
        getCardCanvasClipboardInputFromDataTransfer({
          files: aggregateFiles,
          getData,
          types: ["text/plain"],
        }),
      "CLIPBOARD_CONTENT_TOO_LARGE",
    );
    expect(aggregateVisited).toBe(3);
    expect(getData).not.toHaveBeenCalled();
  });

  it("reads rich ClipboardItems and chooses one preferred image representation", async () => {
    const getTextType = vi.fn((type: string) => {
      const values: Record<string, Blob> = {
        "text/plain": new Blob(["Plain"], { type: "text/plain" }),
        "text/html": new Blob(["<p>Rich</p>"], { type: "text/html" }),
      };
      return Promise.resolve(values[type] ?? new Blob());
    });
    const getImageType = vi.fn((type: string) =>
      Promise.resolve(new Blob(["image"], { type })),
    );

    const result = await readCardCanvasClipboardItems([
      { types: ["text/plain", "text/html"], getType: getTextType },
      {
        types: ["image/webp", "image/png"],
        getType: getImageType,
      },
    ]);

    expect(result.text).toBeUndefined();
    expect(result.html).toBe("<p>Rich</p>");
    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]?.file).toMatchObject({
      name: "clipboard-image-1.png",
      type: "image/png",
    });
    expect(getTextType).toHaveBeenCalledTimes(1);
    expect(getTextType).toHaveBeenCalledWith("text/html");
    expect(getImageType).toHaveBeenCalledOnce();
    expect(result.formats).toEqual([
      "text/plain",
      "text/html",
      "image/webp",
      "image/png",
    ]);
  });

  it("prefers URI-list over plain text in Async Clipboard items", async () => {
    const getType = vi.fn((type: string) =>
      Promise.resolve(
        new Blob([type === "text/uri-list" ? "https://example.com" : "Plain"], {
          type,
        }),
      ),
    );

    const result = await readCardCanvasClipboardItems([
      { types: ["text/plain", "text/uri-list"], getType },
    ]);

    expect(result).toMatchObject({ uriList: "https://example.com" });
    expect(result.text).toBeUndefined();
    expect(getType).toHaveBeenCalledTimes(1);
    expect(getType).toHaveBeenCalledWith("text/uri-list");
  });

  it("rejects oversized ClipboardItem text before reading its contents", async () => {
    const oversized = new Blob(
      [new Uint8Array(MAX_CARD_CANVAS_CLIPBOARD_BYTES + 1)],
      { type: "text/html" },
    );
    const text = vi.spyOn(oversized, "text");

    await expect(
      readCardCanvasClipboardItems([
        {
          types: ["text/html"],
          getType: vi.fn(() => Promise.resolve(oversized)),
        },
      ]),
    ).rejects.toMatchObject({ code: "CLIPBOARD_CONTENT_TOO_LARGE" });
    expect(text).not.toHaveBeenCalled();
  });

  it("reads Async Clipboard images sequentially", async () => {
    let resolveFirst: ((blob: Blob) => void) | undefined;
    const order: string[] = [];
    const first = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          order.push("first:start");
          resolveFirst = (blob) => {
            order.push("first:end");
            resolve(blob);
          };
        }),
    );
    const second = vi.fn(() => {
      order.push("second:start");
      return Promise.resolve(new Blob(["second"], { type: "image/png" }));
    });

    const resultPromise = readCardCanvasClipboardItems([
      { types: ["image/png"], getType: first },
      { types: ["image/png"], getType: second },
    ]);
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
    expect(second).not.toHaveBeenCalled();

    resolveFirst?.(new Blob(["first"], { type: "image/png" }));
    const result = await resultPromise;

    expect(result.images).toHaveLength(2);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("accepts exact 10 MiB images up to the 20 MiB Async Clipboard total", async () => {
    const exact = new Blob([new Uint8Array(MAX_CARD_CANVAS_IMAGE_BYTES)], {
      type: "image/png",
    });

    const result = await readCardCanvasClipboardItems([
      { types: ["image/png"], getType: vi.fn(() => Promise.resolve(exact)) },
      { types: ["image/png"], getType: vi.fn(() => Promise.resolve(exact)) },
    ]);
    const images = result.images ?? [];

    expect(images.map((image) => image.file.size)).toEqual([
      MAX_CARD_CANVAS_IMAGE_BYTES,
      MAX_CARD_CANVAS_IMAGE_BYTES,
    ]);
    expect(images.reduce((total, image) => total + image.file.size, 0)).toBe(
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
    );
  });

  it("rejects an Async Clipboard image over 10 MiB before the next read", async () => {
    const oversized = new Blob(
      [new Uint8Array(MAX_CARD_CANVAS_IMAGE_BYTES + 1)],
      { type: "image/png" },
    );
    const first = vi.fn(() => Promise.resolve(oversized));
    const second = vi.fn(() =>
      Promise.resolve(new Blob(["unread"], { type: "image/png" })),
    );

    await expect(
      readCardCanvasClipboardItems([
        { types: ["image/png"], getType: first },
        { types: ["image/png"], getType: second },
      ]),
    ).rejects.toMatchObject({ code: "CLIPBOARD_CONTENT_TOO_LARGE" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("rejects the twenty-mebibyte-plus-one Async total before another read", async () => {
    const exact = new Blob([new Uint8Array(MAX_CARD_CANVAS_IMAGE_BYTES)], {
      type: "image/png",
    });
    const oneByte = new Blob([new Uint8Array(1)], { type: "image/png" });
    const readers = [
      vi.fn(() => Promise.resolve(exact)),
      vi.fn(() => Promise.resolve(exact)),
      vi.fn(() => Promise.resolve(oneByte)),
      vi.fn(() => Promise.resolve(oneByte)),
    ];

    await expect(
      readCardCanvasClipboardItems(
        readers.map((getType) => ({ types: ["image/png"], getType })),
      ),
    ).rejects.toMatchObject({ code: "CLIPBOARD_CONTENT_TOO_LARGE" });
    expect(readers[0]).toHaveBeenCalledOnce();
    expect(readers[1]).toHaveBeenCalledOnce();
    expect(readers[2]).toHaveBeenCalledOnce();
    expect(readers[3]).not.toHaveBeenCalled();
  });

  it("recognizes internal Excalidraw clipboard formats without parsing a scene", () => {
    expect(
      isCardCanvasInternalClipboard({
        text: '{"type":"excalidraw/clipboard","elements":[',
      }),
    ).toBe(true);
    expect(
      isCardCanvasInternalClipboard({
        formats: ["application/vnd.excalidraw+json"],
      }),
    ).toBe(true);
    expect(
      isCardCanvasInternalClipboard({
        text: '{"type":"external","elements":[]}',
      }),
    ).toBe(false);
  });
});

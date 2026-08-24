import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CardWebLinkDialog } from "./CardWebLinkDialog";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("@headlessui/react", () => {
  const PassThrough = ({ children }: { children: React.ReactNode }) => children;
  const Dialog = Object.assign(PassThrough, {
    Panel: PassThrough,
    Title: PassThrough,
  });
  return {
    Dialog,
    Transition: { Root: PassThrough, Child: PassThrough },
  };
});

vi.mock("~/components/Button", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      cardResource: { list: { invalidate: vi.fn() } },
      card: { byId: { invalidate: vi.fn() } },
      board: { byId: { invalidate: vi.fn() } },
    }),
    cardResource: {
      createWebLink: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/utils/cardInvalidation", () => ({
  invalidateCard: vi.fn(),
}));

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("CardWebLinkDialog", () => {
  it("presents a focused HTTPS form and explains that websites are not embedded", () => {
    const markup = renderToStaticMarkup(
      <CardWebLinkDialog
        cardPublicId="cardpublic01"
        isOpen
        initialUrl="https://example.com/idea"
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain("Add a web link");
    expect(markup).toContain('type="url"');
    expect(markup).toContain('inputMode="url"');
    expect(markup).toContain('maxLength="2048"');
    expect(markup).toContain("The website is never embedded");
    expect(markup).toContain("Add link");
  });
});

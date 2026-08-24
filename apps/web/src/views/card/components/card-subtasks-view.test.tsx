import type { ReactNode } from "react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CardSubtasksView,
  shouldInitializeCardPipeline,
} from "./CardSubtasksView";

const mocks = vi.hoisted(() => ({
  initializeHook: vi.fn(),
  mutationHook: vi.fn(),
  queryHook: vi.fn(),
  useUtils: vi.fn(),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/cards/[cardId]",
    query: {},
    replace: vi.fn(),
  }),
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("react-beautiful-dnd", () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => children,
  Draggable: ({ children }: { children: (provided: object) => ReactNode }) =>
    children({}),
}));

vi.mock("~/components/StrictModeDroppable", () => ({
  StrictModeDroppable: ({
    children,
  }: {
    children: (provided: {
      droppableProps: object;
      innerRef: () => undefined;
      placeholder: null;
    }) => ReactNode;
  }) =>
    children({
      droppableProps: {},
      innerRef: () => undefined,
      placeholder: null,
    }),
}));

vi.mock("~/providers/popup", () => ({
  usePopup: () => ({ showPopup: vi.fn() }),
}));

vi.mock("~/utils/card-workspace", () => ({
  getCardWorkspaceNavigationQuery: (query: object) => query,
  getNextTabIndex: () => null,
}));

vi.mock("./DevelopmentProgress", () => ({
  DevelopmentProgress: () => <div data-development-progress="true" />,
}));

vi.mock("./PipelineStageColumn", () => ({
  PipelineStageColumn: () => null,
}));

vi.mock("./SubtaskEditorDialog", () => ({
  SubtaskEditorDialog: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: mocks.useUtils,
    cardPipeline: {
      get: { useQuery: mocks.queryHook },
      initialize: { useMutation: mocks.initializeHook },
      updateStages: { useMutation: mocks.mutationHook },
    },
    cardSubtask: {
      create: { useMutation: mocks.mutationHook },
      update: { useMutation: mocks.mutationHook },
      move: { useMutation: mocks.mutationHook },
      reorder: { useMutation: mocks.mutationHook },
      delete: { useMutation: mocks.mutationHook },
      setOwner: { useMutation: mocks.mutationHook },
      createChecklistItem: { useMutation: mocks.mutationHook },
      updateChecklistItem: { useMutation: mocks.mutationHook },
      deleteChecklistItem: { useMutation: mocks.mutationHook },
    },
  },
}));

const createMutation = () => ({
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
});

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useUtils.mockReturnValue({
    board: { byId: { invalidate: vi.fn() } },
    card: { byId: { invalidate: vi.fn() } },
    cardPipeline: { get: { invalidate: vi.fn() } },
  });
  mocks.queryHook.mockReturnValue({
    data: {
      initialized: true,
      stages: [],
      summary: { total: 0, completed: 0, blocked: 0, progressPercent: 0 },
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  });
  mocks.initializeHook.mockImplementation(createMutation);
  mocks.mutationHook.mockImplementation(createMutation);
});

const defaultProps = {
  cardPublicId: "cardpublic01",
  members: [],
  canEdit: true,
};

describe("CardSubtasksView", () => {
  it("requires an explicit request and edit permission before initialization", () => {
    const readyState = {
      canEdit: true,
      initializationRequested: true,
      isOnline: true,
      browserIsOnline: true,
      hasPipeline: true,
      pipelineInitialized: false,
      didInitializationFail: false,
      initializationStarted: false,
      initializationPending: false,
    };

    expect(shouldInitializeCardPipeline(readyState)).toBe(true);
    expect(
      shouldInitializeCardPipeline({
        ...readyState,
        initializationRequested: false,
      }),
    ).toBe(false);
    expect(
      shouldInitializeCardPipeline({ ...readyState, canEdit: false }),
    ).toBe(false);
  });

  it("does not mount pipeline hooks while disabled", () => {
    const markup = renderToStaticMarkup(
      <CardSubtasksView {...defaultProps} enabled={false} />,
    );

    expect(markup).toBe("");
    expect(mocks.useUtils).not.toHaveBeenCalled();
    expect(mocks.queryHook).not.toHaveBeenCalled();
    expect(mocks.initializeHook).not.toHaveBeenCalled();
    expect(mocks.mutationHook).not.toHaveBeenCalled();
  });

  it("keeps the tab panel contract and full height by default", () => {
    const markup = renderToStaticMarkup(<CardSubtasksView {...defaultProps} />);

    expect(markup).toContain('id="card-view-subtasks"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-labelledby="card-tab-subtasks"');
    expect(markup).toMatch(/\bh-full\b/);
    expect(markup).toContain('data-development-progress="true"');
    expect(mocks.queryHook).toHaveBeenCalledWith(
      { cardPublicId: defaultProps.cardPublicId },
      { enabled: true, retry: 1 },
    );
  });

  it("uses natural height without duplicate tab panel semantics when embedded", () => {
    const markup = renderToStaticMarkup(
      <CardSubtasksView {...defaultProps} embedded />,
    );

    expect(markup).not.toContain('id="card-view-subtasks"');
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).not.toContain('aria-labelledby="card-tab-subtasks"');
    expect(markup).not.toMatch(/\bh-full\b/);
    expect(markup).not.toContain('data-development-progress="true"');
  });

  it("waits for an explicit activation request before starting an empty pipeline", () => {
    mocks.queryHook.mockReturnValue({
      data: {
        initialized: false,
        stages: [],
        summary: { total: 0, completed: 0, blocked: 0, progressPercent: 0 },
      },
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    const markup = renderToStaticMarkup(
      <CardSubtasksView
        {...defaultProps}
        embedded
        initializationRequested={false}
        onRequestInitialization={vi.fn()}
      />,
    );

    expect(markup).toContain("Activate subtasks");
    expect(markup).toContain(
      "Activate the pipeline when you are ready to break down the work.",
    );
    expect(markup).not.toContain('data-development-progress="true"');
  });
});

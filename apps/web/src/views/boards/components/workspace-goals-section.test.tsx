import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceGoalsSection } from "./WorkspaceGoalsSection";

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as {
    cleanup?: () => void;
    deps?: readonly unknown[];
    next?: () => void | (() => void);
  }[],
  stateCursor: 0,
  refCursor: 0,
  effectCursor: 0,
}));

const dashboard = vi.hoisted(() => ({
  mode: "default" as "default" | "workspace-whiteboard",
  scrollContainerRef: { current: {} as unknown },
}));

vi.mock("react", async (importOriginal) => {
  const actual: typeof React = await importOriginal();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.stateCursor++;
      if (!(index in hooks.state)) {
        hooks.state[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((current: T) => T)) => {
        hooks.state[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(hooks.state[index] as T)
            : next;
      };
      return [hooks.state[index] as T, setState];
    },
    useRef<T>(initial: T) {
      const index = hooks.refCursor++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = hooks.effectCursor++;
      const previous = hooks.effects[index];
      const changed =
        !previous ||
        !deps ||
        !previous.deps ||
        deps.length !== previous.deps.length ||
        deps.some(
          (dependency, dependencyIndex) =>
            !Object.is(dependency, previous.deps?.[dependencyIndex]),
        );
      hooks.effects[index] = {
        cleanup: previous?.cleanup,
        deps,
        next: changed ? effect : undefined,
      };
    },
  };
});

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, part, index) =>
        `${result}${part}${index < values.length ? String(values[index]) : ""}`,
      "",
    ),
}));

vi.mock("~/components/DashboardSurfaceContext", () => ({
  useDashboardSurface: () => ({
    mode: dashboard.mode,
    scrollContainerRef: dashboard.scrollContainerRef,
  }),
}));

class TestIntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  readonly observed: unknown[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    TestIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const beginRender = () => {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
};

const flushEffects = () => {
  for (const effect of hooks.effects) {
    if (!effect.next) continue;
    effect.cleanup?.();
    const cleanup = effect.next();
    effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    effect.next = undefined;
  }
};

const renderSection = (
  workspacePublicId: string,
): React.ReactElement<{ children?: React.ReactNode }> => {
  beginRender();
  return WorkspaceGoalsSection({
    workspacePublicId,
    workspaceName: workspacePublicId,
    canEdit: true,
  }) as React.ReactElement<{ children?: React.ReactNode }>;
};

const attachSection = (
  element: React.ReactElement<{ children?: React.ReactNode }>,
) => {
  const sectionRef = (element as unknown as { ref: { current: unknown } }).ref;
  sectionRef.current = {};
};

const findCanvas = (
  element: React.ReactElement<{ children?: React.ReactNode }>,
) =>
  React.Children.toArray(element.props.children).find(
    (child) =>
      React.isValidElement(child) &&
      "workspacePublicId" in (child.props as Record<string, unknown>),
  ) as React.ReactElement<{ workspacePublicId: string }> | undefined;

describe("WorkspaceGoalsSection", () => {
  beforeEach(() => {
    hooks.state.length = 0;
    hooks.refs.length = 0;
    hooks.effects.length = 0;
    dashboard.mode = "default";
    TestIntersectionObserver.instances.length = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      TestIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    vi.stubGlobal("React", React);
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      head: {
        querySelector: () => ({}),
      },
    });
  });

  afterEach(() => {
    for (const effect of hooks.effects) effect.cleanup?.();
    vi.unstubAllGlobals();
  });

  it("observes the new section again before mounting a changed workspace", () => {
    let element = renderSection("workspace001");
    attachSection(element);
    flushEffects();

    const firstObserver = TestIntersectionObserver.instances.at(-1);
    expect(firstObserver?.options?.root).toBe(
      dashboard.scrollContainerRef.current,
    );
    expect(firstObserver?.observed).toHaveLength(1);
    firstObserver?.trigger();

    element = renderSection("workspace001");
    flushEffects();
    element = renderSection("workspace001");
    expect(findCanvas(element)?.props.workspacePublicId).toBe("workspace001");

    element = renderSection("workspace002");
    expect(findCanvas(element)).toBeUndefined();
    flushEffects();

    const secondObserver = TestIntersectionObserver.instances.at(-1);
    expect(secondObserver).not.toBe(firstObserver);
    expect(secondObserver?.observed).toHaveLength(1);
    secondObserver?.trigger();

    element = renderSection("workspace002");
    expect(findCanvas(element)?.props.workspacePublicId).toBe("workspace002");
  });

  it("makes the document heading inert while the canvas is extended", () => {
    dashboard.mode = "workspace-whiteboard";
    const element = renderSection("workspace001");
    const headingRegion = React.Children.toArray(element.props.children)[0];

    expect(React.isValidElement(headingRegion)).toBe(true);
    expect(
      (headingRegion as React.ReactElement<{ inert?: string }>).props.inert,
    ).toBe("true");
  });
});

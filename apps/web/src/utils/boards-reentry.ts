export const BOARDS_REENTRY_EVENT = "kan:boards-reentry";

export const announceBoardsReentry = () => {
  window.dispatchEvent(new Event(BOARDS_REENTRY_EVENT));
};

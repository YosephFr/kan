export function getBoardUploadCount(
  lists: {
    cards: { resourceSummary: { uploads: number } }[];
  }[],
) {
  return lists.reduce(
    (total, list) =>
      total +
      list.cards.reduce(
        (listTotal, card) => listTotal + card.resourceSummary.uploads,
        0,
      ),
    0,
  );
}

export function getBoardResourceCount(
  lists: {
    cards: { resourceSummary: { total: number } }[];
  }[],
) {
  return lists.reduce(
    (total, list) =>
      total +
      list.cards.reduce(
        (listTotal, card) => listTotal + card.resourceSummary.total,
        0,
      ),
    0,
  );
}

interface VisualWallVersion {
  exists: boolean;
  version: number;
  updatedAt: Date | null;
}

export const applySavedVisualWallChange = <Snapshot extends VisualWallVersion>(
  snapshot: Snapshot | undefined,
  saved: { version: number; updatedAt: Date },
  update: (snapshot: Snapshot) => Snapshot,
): Snapshot | undefined => {
  if (!snapshot || snapshot.version < saved.version - 1) return undefined;
  if (snapshot.version >= saved.version) return snapshot;
  return {
    ...update(snapshot),
    exists: true,
    version: saved.version,
    updatedAt: saved.updatedAt,
  };
};

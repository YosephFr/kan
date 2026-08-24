import type { WorkspaceMemberOption } from "./subtask-types";

export interface CardWhiteboardCanvasProps {
  cardPublicId: string;
  cardTitle: string;
  members: WorkspaceMemberOption[];
  canEdit: boolean;
  isPublicBoard: boolean;
  compact?: boolean;
  embedded?: boolean;
  isVisible?: boolean;
  extended: boolean;
  onExtendedChange: (extended: boolean) => void;
  onCanvasCreated?: () => void;
  onClose?: () => void;
}

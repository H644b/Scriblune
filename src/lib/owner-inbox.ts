export const requestStatuses = [
  "open",
  "in_progress",
  "needs_owner",
  "done",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export const requestStatusLabels: Record<RequestStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  needs_owner: "Needs your reply",
  done: "Done",
};
export type OwnerRequest = {
  id: string;
  title: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  unread: number;
  pending: number;
};
export type OwnerMessage = {
  id: string;
  seq: string;
  author_kind: "owner" | "codex";
  body: string;
  status_after: RequestStatus;
  created_at: string;
};
export type OwnerThread = {
  thread: OwnerRequest;
  messages: OwnerMessage[];
  hasOlder: boolean;
};

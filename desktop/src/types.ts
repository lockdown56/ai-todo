export type TaskView = "inbox" | "today" | "all" | "completed" | "trash";
export type TaskSort =
  | "manual"
  | "created_asc"
  | "created_desc"
  | "due_asc"
  | "priority_desc";

export interface Health {
  status: string;
  database: string;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
}

export interface AuthToken {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  expires_at: string;
  user: AuthUser;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
  system_type: "inbox" | null;
  sort_order: number;
  task_count: number;
  deleted_at: string | null;
  deletion_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  list_id: string;
  title: string;
  description: string;
  due_at: string | null;
  is_all_day: boolean;
  reminder_at: string | null;
  priority: 0 | 1 | 3 | 5;
  status: 0 | 2;
  completed_at: string | null;
  sort_order: number;
  deleted_at: string | null;
  deletion_batch_id: string | null;
  tags: Tag[];
  checklist_items: ChecklistItem[];
  created_at: string;
  updated_at: string;
}

export interface TaskPage {
  items: Task[];
  next_cursor: string | null;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields: unknown;
  };
}

export type TaskPatch = Partial<{
  list_id: string;
  title: string;
  description: string;
  due_at: string | null;
  is_all_day: boolean;
  reminder_at: string | null;
  priority: 0 | 1 | 3 | 5;
  sort_order: number;
  tag_ids: string[];
}>;

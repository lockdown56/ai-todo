import { Button } from "@/components/ui/button";
import { RotateCcw, Trash2 } from "lucide-react";
import type { TaskList } from "@/types";

export function DeletedLists({ lists, onRestore, onDelete }: { lists: TaskList[]; onRestore: (id: string) => void; onDelete: (list: TaskList) => void }) {
  return (
    <section className="deleted-lists">
      <span className="field-label">已删除清单</span>
      {lists.map((list) => (
        <div key={list.id}>
          <span className="list-dot" style={{ backgroundColor: list.color }} />
          <span>{list.name}</span>
          <Button variant="ghost" size="sm" onClick={() => onRestore(list.id)}><RotateCcw /> 恢复</Button>
          <Button variant="ghost" size="sm" className="danger-text" onClick={() => onDelete(list)}><Trash2 /> 永久删除</Button>
        </div>
      ))}
    </section>
  );
}
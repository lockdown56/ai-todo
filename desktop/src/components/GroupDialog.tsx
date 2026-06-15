import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircle } from "lucide-react";
import { errorMessage } from "@/lib/error-utils";
import type { ListGroup } from "@/types";

export function GroupDialog({
  mode,
  group,
  onClose,
  onSubmit,
}: {
  mode: "create" | "rename";
  group?: ListGroup;
  onClose: () => void;
  onSubmit: (values: { name: string }) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const title = mode === "create" ? "新建分组" : "重命名分组";
  const description =
    mode === "create" ? "创建一个分组来整理相关清单。" : "输入新的分组名称。";

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned) return;
    setPending(true);
    setError("");
    try {
      await onSubmit({ name: cleaned });
    } catch (submitError) {
      setPending(false);
      setError(errorMessage(submitError));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="list-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="form-field">
            <Label htmlFor="group-name">名称</Label>
            <Input
              id="group-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="例如：工作、个人、项目"
            />
          </div>
          {error && <div className="inline-error">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending && <LoaderCircle className="spin" />}
              {mode === "create" ? "创建" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

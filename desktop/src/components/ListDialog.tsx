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
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/error-utils";
import { tagColors } from "@/lib/constants";
import type { TaskList } from "@/types";

export function ListDialog({
  mode,
  list,
  onClose,
  onSubmit,
}: {
  mode: "create" | "rename" | "color";
  list?: TaskList;
  onClose: () => void;
  onSubmit: (values: { name: string; color: string }) => Promise<void>;
}) {
  const [name, setName] = useState(list?.name || "");
  const [color, setColor] = useState(list?.color || tagColors[0]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const title =
    mode === "create" ? "新建清单" : mode === "rename" ? "重命名清单" : "更改清单颜色";
  const description =
    mode === "create"
      ? "创建一个清单来组织相关任务。"
      : mode === "rename"
        ? "输入新的清单名称。"
        : "选择一个便于识别的清单颜色。";

  const submit = async () => {
    const cleaned = name.trim();
    if (!cleaned || !/^#[0-9a-f]{6}$/i.test(color)) return;
    setPending(true);
    setError("");
    try {
      await onSubmit({ name: cleaned, color });
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
          {mode !== "color" && (
            <div className="form-field">
              <Label htmlFor="list-name">名称</Label>
              <Input
                id="list-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="例如：工作、购物、学习"
              />
            </div>
          )}
          {mode !== "rename" && (
            <div className="form-field">
              <Label>颜色</Label>
              <div className="color-options">
                {tagColors.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn("color-option", color === option && "selected")}
                    style={{ backgroundColor: option }}
                    onClick={() => setColor(option)}
                    aria-label={`选择颜色 ${option}`}
                    aria-pressed={color === option}
                  />
                ))}
                <Input
                  type="color"
                  className="color-input"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  aria-label="自定义清单颜色"
                />
              </div>
            </div>
          )}
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
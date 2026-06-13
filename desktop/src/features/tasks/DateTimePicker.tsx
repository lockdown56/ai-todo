import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pickerBaseDate,
  monthStart,
  addMonths,
  calendarDays,
  isSameLocalDay,
  isLocalDayAfter,
  formatTimeInput,
  parseTimeInput,
  formatPickerValue,
  formatDayLabel,
} from "@/lib/date-utils";
import { weekDayLabels } from "@/lib/constants";

export function DateTimePicker({
  label,
  value,
  allDay = false,
  disabled = false,
  max = null,
  onChange,
}: {
  label: string;
  value: string | null;
  allDay?: boolean;
  disabled?: boolean;
  max?: string | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(pickerBaseDate(value, max)));
  const [time, setTime] = useState(() => formatTimeInput(pickerBaseDate(value, max)));

  const setPickerOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      const baseDate = pickerBaseDate(value, max);
      setVisibleMonth(monthStart(baseDate));
      setTime(formatTimeInput(baseDate));
    }
    setOpen(nextOpen);
  };

  const days = calendarDays(visibleMonth);
  const selectedDate = value ? new Date(value) : null;
  const maxDate = max ? new Date(max) : null;

  const selectDate = (day: Date) => {
    const [hours, minutes] = allDay ? [0, 0] : parseTimeInput(time);
    let selected = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hours,
      minutes,
    );
    if (maxDate && selected > maxDate) selected = maxDate;
    onChange(selected.toISOString());
    setOpen(false);
  };

  return (
    <div className="date-picker">
      <Popover open={open} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn("date-trigger", !value && "placeholder")}
            disabled={disabled}
            aria-label={label}
          >
            {formatPickerValue(value, allDay)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="date-picker-popover"
          align="start"
          role="dialog"
          aria-label={`${label}选择器`}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <div className="date-picker-header">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              aria-label="上个月"
            >
              <ChevronLeft />
            </Button>
            <strong>{visibleMonth.getFullYear()}年{visibleMonth.getMonth() + 1}月</strong>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-button"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              aria-label="下个月"
            >
              <ChevronRight />
            </Button>
          </div>
          {!allDay && (
            <Label className="date-picker-time">
              时间
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-label={`${label}时间`}
              />
            </Label>
          )}
          <div className="date-picker-weekdays" aria-hidden="true">
            {weekDayLabels.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="date-picker-grid">
            {days.map((day) => {
              const outsideMonth = day.getMonth() !== visibleMonth.getMonth();
              const selected = selectedDate ? isSameLocalDay(day, selectedDate) : false;
              const unavailable = maxDate ? isLocalDayAfter(day, maxDate) : false;
              return (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={[
                    "date-picker-day",
                    outsideMonth ? "outside-month" : "",
                    selected ? "selected" : "",
                  ].filter(Boolean).join(" ")}
                  key={day.toISOString()}
                  disabled={unavailable}
                  aria-label={formatDayLabel(day)}
                  aria-pressed={selected}
                  onClick={() => selectDate(day)}
                >
                  {day.getDate()}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
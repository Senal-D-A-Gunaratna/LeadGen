"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface MonthYearSelectorProps {
  displayedMonth: Date;
  onMonthChange: (month: Date) => void;
  onClose?: () => void;
  onMonthPickerMount?: (node: HTMLElement | null) => void;
  pickerClassName?: string;
  showYearSelector?: boolean;
  disableFutureMonths?: boolean;
}

export const MonthYearSelector = React.forwardRef<
  HTMLDivElement,
  MonthYearSelectorProps
>(
    (
    {
      displayedMonth,
      onMonthChange,
      onClose,
      onMonthPickerMount,
      pickerClassName,
      showYearSelector = true,
      disableFutureMonths = false,
    },
    ref
  ) => {
    const [showMonthPicker, setShowMonthPicker] = React.useState(false);
    const [monthPickerYear, setMonthPickerYear] = React.useState<number>(
      displayedMonth.getFullYear()
    );
    const monthPickerRef = React.useRef<HTMLDivElement | null>(null);
    const monthHeaderRef = React.useRef<HTMLDivElement | null>(null);

    // Notify parent when the month picker DOM node mounts/unmounts so
    // parent components (Radix Popover consumers) can decide to ignore
    // dismissal events that originate from inside this node.
    React.useEffect(() => {
      onMonthPickerMount?.(monthPickerRef.current ?? null);
      return () => onMonthPickerMount?.(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monthPickerRef.current, onMonthPickerMount]);

    // Handle clicks outside month picker
    React.useEffect(() => {
      if (!showMonthPicker) return;
      function onPointerDown(e: PointerEvent) {
        const el = monthPickerRef.current;
        const header = monthHeaderRef.current;
        if (!el) return;
        // If pointer event is inside the picker or on the header toggle, ignore
        if (el.contains(e.target as Node)) return;
        if (header && header.contains(e.target as Node)) return;
        // Prevent the outside pointer event from bubbling to parent components (eg. Radix Popover)
        // so only the month picker closes and the parent popover/calendar remain open.
        e.stopPropagation();
        // Also prevent other listeners on the same event from running.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any).stopImmediatePropagation?.();
        setShowMonthPicker(false);
      }
      // Use capture phase so this runs before most document-level dismissal handlers.
      window.addEventListener("pointerdown", onPointerDown, true);
      return () => window.removeEventListener("pointerdown", onPointerDown, true);
    }, [showMonthPicker]);

    const handlePrevMonth = () => {
      const newMonth = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() - 1,
        1
      );
      onMonthChange(newMonth);
    };

    const handleNextMonth = () => {
      const newMonth = new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + 1,
        1
      );
      if (
        disableFutureMonths &&
        newMonth > new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      ) {
        return;
      }
      onMonthChange(newMonth);
    };

    const handleMonthSelect = (monthIndex: number) => {
      const newMonth = new Date(monthPickerYear, monthIndex, 1);
      if (
        disableFutureMonths &&
        newMonth > new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      ) {
        return;
      }
      onMonthChange(newMonth);
      setShowMonthPicker(false);
    };

    const handleYearChange = (delta: number) => {
      setMonthPickerYear((y) => y + delta);
    };

    const handleThisMonth = () => {
      onMonthChange(new Date());
      setShowMonthPicker(false);
    };

    const canGoNext = !disableFutureMonths ||
      new Date(
        displayedMonth.getFullYear(),
        displayedMonth.getMonth() + 1,
        1
      ) <= new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    return (
      <div ref={ref} className="relative w-full">
        {/* Header with month/year navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            className="p-1 rounded-md hover:bg-accent/50"
            onClick={handlePrevMonth}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <div
            ref={monthHeaderRef}
            className={cn(
              "text-sm font-medium cursor-pointer select-none rounded px-2 py-1",
              showYearSelector
                ? "hover:bg-accent/50"
                : "bg-transparent cursor-default"
            )}
            role={showYearSelector ? "button" : undefined}
            tabIndex={showYearSelector ? 0 : undefined}
            onClick={() => {
              if (showYearSelector) {
                setMonthPickerYear(displayedMonth.getFullYear());
                setShowMonthPicker((s) => !s);
              }
            }}
            onKeyDown={(e) => {
              if (showYearSelector && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                setMonthPickerYear(displayedMonth.getFullYear());
                setShowMonthPicker((s) => !s);
              }
            }}
          >
            {format(displayedMonth, "MMMM yyyy")}
          </div>

          <button
            type="button"
            aria-label="Next month"
            className={cn("p-1 rounded-md", canGoNext && "hover:bg-accent/50")}
            onClick={handleNextMonth}
            disabled={!canGoNext}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Month/Year Picker Dropdown */}
        {showYearSelector && showMonthPicker && (
          <div
            ref={monthPickerRef}
            className="absolute z-50 left-1/2 top-12 -translate-x-1/2 w-64"
          >
            <div className={cn(
              "w-full p-3 rounded-md border border-border",
              pickerClassName ?? "month-picker-glass"
            )}>
              {/* Year navigation */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  aria-label="Previous year"
                  onClick={() => handleYearChange(-1)}
                  className="p-1 rounded-md hover:bg-accent/50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium">{monthPickerYear}</div>
                <button
                  type="button"
                  aria-label="Next year"
                  onClick={() => handleYearChange(1)}
                  className="p-1 rounded-md hover:bg-accent/50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Month grid */}
              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec",
                ].map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleMonthSelect(i)}
                    className={cn(
                      "text-sm py-1 rounded transition-colors",
                      displayedMonth.getFullYear() === monthPickerYear &&
                        displayedMonth.getMonth() === i
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent/20"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Footer buttons */}
              <div className="flex justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleThisMonth}
                >
                  This month
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setShowMonthPicker(false);
                    onClose?.();
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

MonthYearSelector.displayName = "MonthYearSelector";

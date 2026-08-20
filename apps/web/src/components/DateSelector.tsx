import { t } from "@lingui/core/macro";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useMemo, useState } from "react";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { useLocalisation } from "~/hooks/useLocalisation";
import { getLocalTimeZone } from "~/utils/card-presentation";

interface DateSelectorProps {
  selectedDate?: Date | null;
  onDateSelect?: (date: Date | undefined) => void;
  weekStartsOn?: 0 | 1 | 6;
  showTime?: boolean;
}

const DateSelector = ({
  selectedDate,
  onDateSelect,
  weekStartsOn = 1,
  showTime = false,
}: DateSelectorProps) => {
  const { dateLocale } = useLocalisation();
  const [currentMonth, setCurrentMonth] = useState(() => {
    return selectedDate ? startOfMonth(selectedDate) : startOfMonth(new Date());
  });

  const monthName = format(currentMonth, "MMMM", { locale: dateLocale });
  const year = format(currentMonth, "yyyy");

  const dayHeaders = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn });
    return eachDayOfInterval({
      start: weekStart,
      end: new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000),
    }).map((date) => format(date, "EEEEEE", { locale: dateLocale }));
  }, [dateLocale, weekStartsOn]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd }).map(
      (date) => {
        const dateString = format(date, "yyyy-MM-dd");
        return {
          date: dateString,
          isToday: isToday(date),
          isSelected: selectedDate ? isSameDay(date, selectedDate) : false,
          isCurrentMonth: date >= monthStart && date <= monthEnd,
          dateObj: date,
        };
      },
    );
  }, [currentMonth, selectedDate, weekStartsOn]);

  const handlePreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const handleDateClick = (date: Date, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedDate && isSameDay(date, selectedDate)) {
      onDateSelect?.(undefined);
    } else {
      const nextDate = new Date(date);
      if (showTime) {
        if (selectedDate) {
          nextDate.setHours(
            selectedDate.getHours(),
            selectedDate.getMinutes(),
            0,
            0,
          );
        } else {
          nextDate.setHours(23, 59, 0, 0);
        }
      }
      onDateSelect?.(nextDate);
    }
  };

  const handleTimeChange = (value: string) => {
    if (!selectedDate || !value) return;
    const [hours, minutes] = value.split(":").map(Number);
    if (hours === undefined || minutes === undefined) return;
    const nextDate = new Date(selectedDate);
    nextDate.setHours(hours, minutes, 0, 0);
    onDateSelect?.(nextDate);
  };

  return (
    <div className="w-[calc(100vw-2rem)] max-w-[250px] p-4">
      <div className="flex items-center text-light-1000 dark:text-dark-1000">
        <button
          type="button"
          onClick={handlePreviousMonth}
          className="flex flex-none items-center justify-center p-1.5 text-light-700 hover:text-light-900 dark:text-dark-700 dark:hover:text-dark-1000"
        >
          <span className="sr-only">{t`Previous month`}</span>
          <HiChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center text-sm font-semibold">
          {monthName} {year}
        </div>
        <button
          type="button"
          onClick={handleNextMonth}
          className="flex flex-none items-center justify-center p-1.5 text-light-700 hover:text-light-900 dark:text-dark-700 dark:hover:text-dark-1000"
        >
          <span className="sr-only">{t`Next month`}</span>
          <HiChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-6 grid grid-cols-7 text-center text-xs/6 text-light-950 dark:text-dark-950">
        {dayHeaders.map((day, index) => (
          <div key={index}>{day}</div>
        ))}
      </div>
      <div className="isolate mt-2 grid grid-cols-7 text-sm">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            onClick={(e) => handleDateClick(day.dateObj, e)}
            className={twMerge(
              "flex aspect-square items-center justify-center rounded-lg focus:z-10",
              day.isSelected
                ? "bg-light-1000 hover:bg-light-1000 dark:bg-dark-1000 dark:hover:bg-dark-1000"
                : "bg-transparent hover:bg-light-200 dark:bg-transparent dark:hover:bg-dark-200",
            )}
          >
            <time
              dateTime={day.date}
              className={twMerge(
                "mx-auto flex size-7 items-center justify-center rounded-full text-light-900 dark:text-dark-900",
                day.isCurrentMonth
                  ? "text-light-900 dark:text-dark-900"
                  : "text-light-700 dark:text-dark-600",
                day.isSelected && "text-light-50 dark:text-dark-50",
              )}
            >
              {day.date.split("-").pop()?.replace(/^0/, "")}
            </time>
          </button>
        ))}
      </div>
      {showTime && (
        <div className="mt-4 border-t border-light-300 pt-3 dark:border-dark-400">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="due-time"
              className="text-xs font-medium text-light-900 dark:text-dark-900"
            >
              {t`Time`}
            </label>
            <input
              id="due-time"
              type="time"
              value={selectedDate ? format(selectedDate, "HH:mm") : ""}
              disabled={!selectedDate}
              onChange={(event) => handleTimeChange(event.target.value)}
              className="rounded-md border border-light-400 bg-light-50 px-2 py-1 text-xs text-light-950 focus:border-light-800 focus:ring-light-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-500 dark:bg-dark-200 dark:text-dark-950 dark:focus:border-dark-800 dark:focus:ring-dark-800"
            />
          </div>
          <p className="mt-2 text-[10px] text-light-700 dark:text-dark-700">
            {t`Local time zone`}: {getLocalTimeZone()}
          </p>
        </div>
      )}
    </div>
  );
};

export default DateSelector;
